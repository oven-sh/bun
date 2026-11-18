mod support;

use bun_engine_asm::x64::*;
use bun_engine_asm::{Address, FloatWidth, Fpr, Gpr, Scale, Size, Width, X64Features};

const SIZES: [Size; 4] = [Size::S8, Size::S16, Size::S32, Size::S64];
const WIDTHS: [Width; 2] = [Width::W32, Width::W64];
const IMMEDIATES: [i32; 7] = [0, 1, -1, 127, -128, 128, 0x1234_5678];

fn gprs() -> impl Iterator<Item = Gpr> + Clone {
    (0..16).map(Gpr::new)
}

fn some_gprs() -> [Gpr; 6] {
    [RAX, RBX, RSP, RSI, R8, R13]
}

fn some_fprs() -> [Fpr; 4] {
    [XMM0, XMM7, XMM8, XMM15]
}

fn name(reg: Gpr, size: Size) -> String {
    const LEGACY: [&str; 8] = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"];
    let number = reg.number() as usize;
    if number >= 8 {
        return format!("r{number}{}", ["b", "w", "d", ""][size as usize]);
    }
    let base = LEGACY[number];
    match size {
        Size::S8 if number < 4 => format!("{}l", &base[..1]),
        Size::S8 => format!("{base}l"),
        Size::S16 => base.into(),
        Size::S32 => format!("e{base}"),
        Size::S64 => format!("r{base}"),
    }
}

fn xmm(reg: Fpr) -> String {
    format!("xmm{}", reg.number())
}

fn bare(address: Address) -> String {
    let mut text = name(address.base(), Size::S64);
    if let Some((index, scale)) = address.index() {
        let factor = if scale == Scale::One {
            String::new()
        } else {
            format!("{}*", 1 << scale.log2())
        };
        text += &format!(" + {factor}{}", name(index, Size::S64));
    }
    match address.offset() {
        0 => {}
        offset if offset < 0 => text += &format!(" - {}", -i64::from(offset)),
        offset => text += &format!(" + {offset}"),
    }
    format!("[{text}]")
}

fn pointer(bytes: u8, address: Address) -> String {
    let kind = match bytes {
        1 => "byte",
        2 => "word",
        4 => "dword",
        8 => "qword",
        _ => "xmmword",
    };
    format!("{kind} ptr {}", bare(address))
}

fn addresses() -> Vec<Address> {
    let mut all = Vec::new();
    for base in gprs() {
        for offset in [0, 1, -128, 127, 128, i32::MIN, i32::MAX] {
            all.push(Address::new(base, offset));
            for index in gprs().filter(|&index| index != RSP) {
                let scale = Scale::from_log2((base.number() + index.number()) % 4).unwrap();
                all.push(Address::indexed(base, index, scale, offset));
            }
        }
    }
    all
}

fn some_addresses() -> [Address; 5] {
    [
        Address::new(RAX, 0),
        Address::new(RSP, 8),
        Address::new(R13, 0),
        Address::indexed(RBP, R12, Scale::Eight, -300),
        Address::indexed(R9, RCX, Scale::Two, 5),
    ]
}

fn lower(op: impl std::fmt::Debug) -> String {
    format!("{op:?}").to_lowercase()
}

fn signed(size: Size, imm: i32) -> i32 {
    match size {
        Size::S8 => (imm as i8).into(),
        Size::S16 => (imm as i16).into(),
        _ => imm,
    }
}

/// How an immediate is printed that is not extended from a byte.
fn full(size: Size, imm: i32) -> i64 {
    match size {
        Size::S16 => (imm as u16).into(),
        Size::S32 => (imm as u32).into(),
        Size::S8 | Size::S64 => signed(size, imm).into(),
    }
}

struct Listing {
    asm: Assembler,
    expected: Vec<String>,
}

impl Listing {
    fn new(features: X64Features) -> Self {
        Self {
            asm: Assembler::new(features, false),
            expected: Vec::new(),
        }
    }

    fn add(&mut self, expected: String, emit: impl FnOnce(&mut Assembler)) {
        emit(&mut self.asm);
        self.expected.push(expected);
    }

    fn check(self) {
        let code = self.asm.finish().unwrap();
        let bytes = &code.bytes()[..code.instructions_end() as usize];
        support::assert_disassembly(
            &["-triple=x86_64", "--output-asm-variant=1"],
            bytes,
            &self.expected,
        );
    }

    /// The text of an instruction that has a first source of its own with AVX.
    fn three(&self, op: &str, dst: Fpr, lhs: Fpr, rest: &str) -> String {
        if self.asm.has(X64Features::AVX) {
            format!("v{op} {}, {}, {rest}", xmm(dst), xmm(lhs))
        } else {
            format!("{op} {}, {rest}", xmm(dst))
        }
    }

    fn two(&self, op: &str, operands: impl std::fmt::Display) -> String {
        format!(
            "{}{op} {operands}",
            if self.asm.has(X64Features::AVX) {
                "v"
            } else {
                ""
            }
        )
    }

    fn first_sources(&self, dst: Fpr) -> Vec<Fpr> {
        if self.asm.has(X64Features::AVX) {
            some_fprs().into()
        } else {
            vec![dst]
        }
    }
}

#[test]
fn every_address() {
    let mut listing = Listing::new(X64Features::all());
    for address in addresses() {
        listing.add(format!("lea r9, {}", bare(address)), |a| {
            a.lea(Width::W64, R9, address)
        });
        listing.add(format!("mov {}, 7", pointer(1, address)), |a| {
            a.mov_store_imm(Size::S8, address, 7)
        });
        listing.add(format!("vaddsd xmm1, xmm9, {}", pointer(8, address)), |a| {
            a.sse(Sse::Addsd, XMM1, XMM9, address)
        });
    }
    listing.add("mov eax, dword ptr [4096]".into(), |a| {
        a.mov(Width::W32, RAX, Assembler::absolute(4096))
    });
    listing.add("lea eax, [8*r10 + 3]".into(), |a| {
        a.lea(
            Width::W32,
            RAX,
            Assembler::without_base(R10, Scale::Eight, 3),
        );
    });
    listing.check();
}

#[test]
fn arithmetic() {
    let mut listing = Listing::new(X64Features::all());
    for size in SIZES {
        let bytes = size.bytes();
        for &op in Alu::ALL {
            let text = lower(op);
            for dst in gprs() {
                let d = name(dst, size);
                for src in gprs() {
                    listing.add(format!("{text} {d}, {}", name(src, size)), |a| {
                        a.alu(op, size, dst, src)
                    });
                }
                for imm in IMMEDIATES {
                    listing.add(format!("{text} {d}, {}", signed(size, imm)), |a| {
                        a.alu_imm(op, size, dst, imm)
                    });
                }
                for m in some_addresses() {
                    listing.add(format!("{text} {d}, {}", pointer(bytes, m)), |a| {
                        a.alu(op, size, dst, m)
                    });
                    listing.add(format!("{text} {}, {d}", pointer(bytes, m)), |a| {
                        a.alu_mem(op, size, m, dst)
                    });
                }
            }
            for (m, imm) in some_addresses()
                .into_iter()
                .zip(IMMEDIATES.into_iter().rev())
            {
                let operands = format!("{}, {}", pointer(bytes, m), signed(size, imm));
                listing.add(format!("{text} {operands}"), |a| {
                    a.alu_imm(op, size, m, imm)
                });
            }
        }
        for reg in gprs() {
            let r = name(reg, size);
            for &op in Unary::ALL {
                listing.add(format!("{} {r}", lower(op)), |a| a.unary(op, size, reg));
            }
            for &op in ShiftOp::ALL {
                listing.add(format!("{} {r}", lower(op)), |a| {
                    a.shift_imm(op, size, reg, 1)
                });
                listing.add(format!("{} {r}, 5", lower(op)), |a| {
                    a.shift_imm(op, size, reg, 5)
                });
                listing.add(format!("{} {r}, cl", lower(op)), |a| {
                    a.shift_cl(op, size, reg)
                });
            }
            for other in some_gprs() {
                listing.add(format!("test {r}, {}", name(other, size)), |a| {
                    a.test(size, reg, other)
                });
            }
            for imm in IMMEDIATES {
                listing.add(format!("test {r}, {}", full(size, imm)), |a| {
                    a.test_imm(size, reg, imm)
                });
            }
            for m in some_addresses() {
                let p = pointer(bytes, m);
                listing.add(format!("mov {p}, {r}"), |a| a.mov_store(size, m, reg));
                listing.add(format!("test {p}, {r}"), |a| a.test(size, m, reg));
                listing.add(format!("xchg {p}, {r}"), |a| a.xchg(size, m, reg));
                listing.add(format!("xadd {p}, {r}"), |a| a.xadd(size, m, reg));
                listing.add(format!("cmpxchg {p}, {r}"), |a| a.cmpxchg(size, m, reg));
            }
        }
        for (m, imm) in some_addresses()
            .into_iter()
            .zip(IMMEDIATES.into_iter().rev())
        {
            let p = pointer(bytes, m);
            listing.add(format!("mov {p}, {}", full(size, imm)), |a| {
                a.mov_store_imm(size, m, imm)
            });
            listing.add(format!("test {p}, {}", full(size, imm)), |a| {
                a.test_imm(size, m, imm)
            });
            listing.add(format!("neg {p}"), |a| a.unary(Unary::Neg, size, m));
        }
    }
    listing.check();
}

#[test]
fn moves_and_bits() {
    let mut listing = Listing::new(X64Features::all());
    let m = Address::indexed(R9, RCX, Scale::Two, 5);
    for dst in gprs() {
        let (d32, d64) = (name(dst, Size::S32), name(dst, Size::S64));
        listing.add(format!("mov {d32}, 5"), |a| a.mov_imm(dst, 5));
        listing.add(format!("mov {d32}, 4294967295"), |a| {
            a.mov_imm(dst, 0xffff_ffff)
        });
        listing.add(format!("mov {d64}, -2"), |a| a.mov_imm(dst, -2));
        listing.add(format!("movabs {d64}, 4294967296"), |a| {
            a.mov_imm(dst, 1 << 32)
        });
        listing.add(format!("push {d64}"), |a| a.push(dst));
        listing.add(format!("pop {d64}"), |a| a.pop(dst));
        listing.add(format!("jmp {d64}"), |a| a.jmp_indirect(dst));
        listing.add(format!("call {d64}"), |a| a.call_indirect(dst));
        for cc in Cc::ALL {
            listing.add(format!("set{} {}", lower(cc), name(dst, Size::S8)), |a| {
                a.setcc(cc, dst)
            });
        }
        for from in [Size::S8, Size::S16] {
            for src in gprs() {
                listing.add(format!("movzx {d32}, {}", name(src, from)), |a| {
                    a.movzx(from, dst, src)
                });
            }
            listing.add(format!("movzx {d32}, {}", pointer(from.bytes(), m)), |a| {
                a.movzx(from, dst, m)
            });
        }
        listing.add(format!("movsxd {d64}, {}", pointer(4, m)), |a| {
            a.movsx(Size::S32, Width::W64, dst, m)
        });
        for width in WIDTHS {
            let size = width.size();
            let (d, p) = (name(dst, size), pointer(size.bytes(), m));
            listing.add(format!("bswap {d}"), |a| a.bswap(width, dst));
            listing.add(format!("mov {d}, {p}"), |a| a.mov(width, dst, m));
            listing.add(format!("imul {d}, {p}"), |a| a.imul(width, dst, m));
            listing.add(format!("imul {d}, {p}, 1000"), |a| {
                a.imul_imm(width, dst, m, 1000)
            });
            for &op in BitTest::ALL {
                listing.add(format!("{} {d}, 9", lower(op)), |a| {
                    a.bit_test_imm(op, width, dst, 9)
                });
            }
            for src in some_gprs() {
                let s = name(src, size);
                listing.add(format!("mov {d}, {s}"), |a| a.mov(width, dst, src));
                listing.add(format!("imul {d}, {s}"), |a| a.imul(width, dst, src));
                listing.add(format!("imul {d}, {s}, -3"), |a| {
                    a.imul_imm(width, dst, src, -3)
                });
                listing.add(format!("bt {d}, {s}"), |a| a.bt(width, dst, src));
                listing.add(format!("shrd {d}, {s}, 3"), |a| {
                    a.shrd_imm(width, dst, src, 3)
                });
                listing.add(format!("rorx {d}, {s}, 3"), |a| a.rorx(width, dst, src, 3));
                listing.add(format!("andn {d}, {s}, {p}"), |a| {
                    a.andn(width, dst, src, m)
                });
                for from in [Size::S8, Size::S16] {
                    listing.add(format!("movsx {d}, {}", name(src, from)), |a| {
                        a.movsx(from, width, dst, src)
                    });
                }
                for cc in Cc::ALL {
                    listing.add(format!("cmov{} {d}, {s}", lower(cc)), |a| {
                        a.cmov(cc, width, dst, src)
                    });
                }
                for &op in BitCount::ALL {
                    listing.add(format!("{} {d}, {s}", lower(op)), |a| {
                        a.bit_count(op, width, dst, src)
                    });
                }
                for &op in ShiftX::ALL {
                    let amount = name(R10, size);
                    listing.add(format!("{} {d}, {s}, {amount}", lower(op)), |a| {
                        a.shiftx(op, width, dst, src, R10)
                    });
                    listing.add(format!("{} {d}, {p}, {s}", lower(op)), |a| {
                        a.shiftx(op, width, dst, m, src)
                    });
                }
            }
        }
    }
    listing.add(format!("push {}", pointer(8, m)), |a| a.push_mem(m));
    listing.add(format!("pop {}", pointer(8, m)), |a| a.pop_mem(m));
    listing.add(format!("jmp {}", pointer(8, m)), |a| a.jmp_indirect(m));
    listing.add(format!("call {}", pointer(8, m)), |a| a.call_indirect(m));
    listing.add(format!("prefetcht0 {}", pointer(1, m)), |a| a.prefetcht0(m));
    listing.add("push -5".into(), |a| a.push_imm(-5));
    listing.add("push 500".into(), |a| a.push_imm(500));
    listing.add("cdq".into(), |a| a.extend_sign_into_rdx(Width::W32));
    listing.add("cqo".into(), |a| a.extend_sign_into_rdx(Width::W64));
    listing.add("ret".into(), |a| a.ret());
    listing.add("leave".into(), |a| a.leave());
    listing.add("int3".into(), |a| a.int3());
    listing.add("ud2".into(), |a| a.ud2());
    listing.check();
}

fn memory_bytes(op: &str) -> u8 {
    let is_packed_integer = op.starts_with('p');
    if op.starts_with("pmov")
        || ["movq", "movddup", "cvtdq2pd", "cvtps2pd", "cvtsd2ss"].contains(&op)
    {
        8
    } else if ["cvtss2sd", "insertps"].contains(&op) || !is_packed_integer && op.ends_with("ss") {
        4
    } else if !is_packed_integer && op.ends_with("sd") {
        8
    } else {
        16
    }
}

fn vector_registers(features: X64Features) {
    let mut listing = Listing::new(features);
    let m = Address::indexed(R9, RCX, Scale::Two, 5);
    for dst in some_fprs() {
        let d = xmm(dst);
        for lhs in listing.first_sources(dst) {
            for &op in Sse::ALL {
                let text = lower(op);
                for rhs in some_fprs() {
                    listing.add(listing.three(&text, dst, lhs, &xmm(rhs)), |a| {
                        a.sse(op, dst, lhs, rhs)
                    });
                }
                let p = pointer(memory_bytes(&text), m);
                listing.add(listing.three(&text, dst, lhs, &p), |a| {
                    a.sse(op, dst, lhs, m)
                });
            }
            for &op in SseImm::ALL {
                let text = lower(op);
                let (text, imm) = match text.strip_prefix("cmp") {
                    Some(shape) => (format!("cmpunord{shape}"), ""),
                    None => (text, ", 3"),
                };
                let p = pointer(memory_bytes(&text), m);
                listing.add(listing.three(&text, dst, lhs, &format!("xmm9{imm}")), |a| {
                    a.sse_imm(op, dst, lhs, XMM9, 3)
                });
                listing.add(listing.three(&text, dst, lhs, &format!("{p}{imm}")), |a| {
                    a.sse_imm(op, dst, lhs, m, 3)
                });
            }
            for &op in SseShiftImm::ALL {
                listing.add(listing.three(&lower(op), dst, lhs, "4"), |a| {
                    a.sse_shift_imm(op, dst, lhs, 4)
                });
            }
            for &op in SseMergeLoad::ALL {
                listing.add(listing.three(&lower(op), dst, lhs, &pointer(8, m)), |a| {
                    a.sse_merge_load(op, dst, lhs, m)
                });
            }
            for &op in SseMerge::ALL {
                listing.add(listing.three(&lower(op), dst, lhs, "xmm9"), |a| {
                    a.sse_merge(op, dst, lhs, XMM9)
                });
            }
            for (to, text) in [(FloatWidth::F32, "cvtsi2ss"), (FloatWidth::F64, "cvtsi2sd")] {
                for from in WIDTHS {
                    let src = name(R10, from.size());
                    listing.add(listing.three(text, dst, lhs, &src), |a| {
                        a.cvtsi2s(from, to, dst, lhs, R10)
                    });
                }
            }
            for (lanes, suffix) in SIZES.into_iter().zip(["b", "w", "d", "q"]) {
                let text = format!("pinsr{suffix}");
                let src = format!("{}, 1", name(RSI, lanes.width().size()));
                listing.add(listing.three(&text, dst, lhs, &src), |a| {
                    a.pinsr(lanes, dst, lhs, RSI, 1)
                });
                let src = format!("{}, 1", pointer(lanes.bytes(), m));
                listing.add(listing.three(&text, dst, lhs, &src), |a| {
                    a.pinsr(lanes, dst, lhs, m, 1)
                });
            }
        }
        for &op in SseUnary::ALL {
            let text = lower(op);
            for src in some_fprs() {
                listing.add(listing.two(&text, format!("{d}, {}", xmm(src))), |a| {
                    a.sse_unary(op, dst, src)
                });
            }
            let p = pointer(memory_bytes(&text), m);
            listing.add(listing.two(&text, format!("{d}, {p}")), |a| {
                a.sse_unary(op, dst, m)
            });
        }
        for &op in SseUnaryImm::ALL {
            listing.add(listing.two(&lower(op), format!("{d}, xmm9, 9")), |a| {
                a.sse_unary_imm(op, dst, XMM9, 9)
            });
        }
        for &op in SseLoad::ALL {
            let p = pointer(memory_bytes(&lower(op)), m);
            listing.add(listing.two(&lower(op), format!("{d}, {p}")), |a| {
                a.sse_load(op, dst, m)
            });
        }
        for &op in SseStore::ALL {
            let p = pointer(
                if op == SseStore::Movhps {
                    8
                } else {
                    memory_bytes(&lower(op))
                },
                m,
            );
            listing.add(listing.two(&lower(op), format!("{p}, {d}")), |a| {
                a.sse_store(op, m, dst)
            });
        }
        for gpr in some_gprs() {
            for &op in MoveMask::ALL {
                let operands = format!("{}, {d}", name(gpr, Size::S32));
                listing.add(listing.two(&lower(op), operands), |a| {
                    a.move_mask(op, gpr, dst)
                });
            }
            for (width, text) in WIDTHS.into_iter().zip(["movd", "movq"]) {
                let r = name(gpr, width.size());
                listing.add(listing.two(text, format!("{d}, {r}")), |a| {
                    a.movd_to_xmm(width, dst, gpr)
                });
                listing.add(listing.two(text, format!("{r}, {d}")), |a| {
                    a.movd_from_xmm(width, gpr, dst)
                });
                for (from, text) in [
                    (FloatWidth::F32, "cvttss2si"),
                    (FloatWidth::F64, "cvttsd2si"),
                ] {
                    listing.add(listing.two(text, format!("{r}, {d}")), |a| {
                        a.cvtts2si(from, width, gpr, dst)
                    });
                }
            }
            for (lanes, suffix) in SIZES.into_iter().zip(["b", "w", "d", "q"]) {
                let text = format!("pextr{suffix}");
                let r = name(gpr, lanes.width().size());
                listing.add(listing.two(&text, format!("{r}, {d}, 1")), |a| {
                    a.pextr(lanes, gpr, dst, 1)
                });
                let p = pointer(lanes.bytes(), m);
                listing.add(listing.two(&text, format!("{p}, {d}, 1")), |a| {
                    a.pextr(lanes, m, dst, 1)
                });
            }
        }
        if features.contains(X64Features::AVX) {
            for src in some_fprs() {
                let s = xmm(src);
                for &op in AvxUnary::ALL {
                    listing.add(format!("{} {d}, {s}", lower(op)), |a| {
                        a.avx_unary(op, dst, src)
                    });
                }
                for &op in Blendv::ALL {
                    listing.add(format!("{} {d}, {s}, xmm3, xmm12", lower(op)), |a| {
                        a.blendv(op, dst, src, XMM3, XMM12)
                    });
                }
                for &op in Fma::ALL {
                    listing.add(format!("{} {d}, {s}, xmm12", lower(op)), |a| {
                        a.fma(op, dst, src, XMM12)
                    });
                }
                listing.add(format!("vcvtps2ph {d}, {s}, 0"), |a| {
                    a.vcvtps2ph(dst, src, 0)
                });
            }
        }
    }
    listing.check();
}

#[test]
fn vector_registers_with_sse() {
    vector_registers(X64Features::empty());
}

#[test]
fn vector_registers_with_avx() {
    vector_registers(X64Features::all());
}

#[test]
fn constants_are_addressed_from_the_end_of_the_instruction() {
    let mut listing = Listing::new(X64Features::empty());
    let constant = listing.asm.constant(1, 16);
    listing.add("pshufd xmm1, xmmword ptr [rip + 23], 3".into(), |a| {
        a.sse_unary_imm(SseUnaryImm::Pshufd, XMM1, constant, 3);
    });
    listing.add("cmp qword ptr [rip + 12], 1000".into(), |a| {
        a.alu_imm(Alu::Cmp, Size::S64, constant, 1000)
    });
    listing.check();
}

fn ymm(reg: Fpr) -> String {
    format!("ymm{}", reg.number())
}

#[test]
fn long_vectors() {
    let mut listing = Listing::new(X64Features::all());
    for dst in some_fprs() {
        for src in some_fprs() {
            listing.add(
                format!("vpand {}, {}, {}", ymm(dst), ymm(src), ymm(dst)),
                |asm| {
                    asm.with_long_vectors(|asm| asm.sse(Sse::Pand, dst, src, dst));
                },
            );
            listing.add(format!("vpsrlw {}, {}, 3", ymm(dst), ymm(src)), |asm| {
                asm.with_long_vectors(|asm| asm.sse_shift_imm(SseShiftImm::Psrlw, dst, src, 3));
            });
            listing.add(
                format!("vpmovmskb {}, {}", name(RAX, Size::S32), ymm(src)),
                |asm| {
                    asm.with_long_vectors(|asm| asm.move_mask(MoveMask::Pmovmskb, RAX, src));
                },
            );
        }
        let address = Address::new(RBX, 32);
        listing.add(
            format!("vbroadcasti128 {}, {}", ymm(dst), pointer(16, address)),
            |asm| {
                asm.broadcast_vector(dst, address);
            },
        );
        // The mode is left behind.
        listing.add(
            format!("vpand {}, {}, {}", xmm(dst), xmm(dst), xmm(dst)),
            |asm| {
                asm.sse(Sse::Pand, dst, dst, dst);
            },
        );
    }
    listing.add("vzeroupper".into(), Assembler::vzeroupper);
    listing.check();
}
