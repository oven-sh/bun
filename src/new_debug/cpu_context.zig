/// Register state for the native architecture, used by `std.debug` for stack unwinding.
/// `noreturn` if there is no implementation for the native architecture.
/// This can be overriden by exposing a declaration `root.debug.CpuContext`.
pub const Native = if (@hasDecl(root, "debug") and @hasDecl(root.debug, "CpuContext"))
    root.debug.CpuContext
else switch (native_arch) {
    .aarch64, .aarch64_be => Aarch64,
    .arc => Arc,
    .arm, .armeb, .thumb, .thumbeb => Arm,
    .csky => Csky,
    .hexagon => Hexagon,
    .lanai => Lanai,
    .loongarch32, .loongarch64 => LoongArch,
    .m68k => M68k,
    .mips, .mipsel, .mips64, .mips64el => Mips,
    .or1k => Or1k,
    .powerpc, .powerpcle, .powerpc64, .powerpc64le => Powerpc,
    .sparc, .sparc64 => Sparc,
    .riscv32, .riscv64 => Riscv,
    .ve => Ve,
    .s390x => S390x,
    .x86 => X86,
    .x86_64 => X86_64,
    else => noreturn,
};

pub const DwarfRegisterError = error{
    InvalidRegister,
    UnsupportedRegister,
};

pub fn fromPosixSignalContext(ctx_ptr: ?*const anyopaque) ?Native {
    if (signal_ucontext_t == void) return null;

    // In general, we include the hardwired zero register in the context if applicable.
    const uc: *const signal_ucontext_t = @ptrCast(@alignCast(ctx_ptr));

    // Deal with some special cases first.
    if (native_arch.isArc() and native_os == .linux) {
        var native: Native = .{
            .r = [_]u32{ uc.mcontext.r31, uc.mcontext.r30, 0, uc.mcontext.r28 } ++
                uc.mcontext.r27_26 ++
                uc.mcontext.r25_13 ++
                uc.mcontext.r12_0,
            .pcl = uc.mcontext.pcl,
        };

        // I have no idea why the kernel is storing these registers in such a bizarre order...
        std.mem.reverse(native.r[0..]);

        return native;
    } else if (native_arch.isMIPS32() and native_os == .linux) {
        // The O32 kABI uses 64-bit fields for some reason.
        return .{
            .r = s: {
                var regs: [32]Mips.Gpr = undefined;
                for (uc.mcontext.r, 0..) |r, i| regs[i] = @truncate(r);
                break :s regs;
            },
            .pc = @truncate(uc.mcontext.pc),
        };
    } else if (native_arch.isSPARC() and native_os == .linux) {
        const SparcStackFrame = extern struct {
            l: [8]usize,
            i: [8]usize,
            _x: [8]usize,
        };

        // When invoking a signal handler, the kernel builds an `rt_signal_frame` structure on the
        // stack and passes a pointer to its `info` field to the signal handler. This implies that
        // prior to said `info` field, we will find the `ss` field which, among other things,
        // contains the incoming and local registers of the interrupted code.
        const frame = @as(*const SparcStackFrame, @ptrFromInt(@as(usize, @intFromPtr(ctx_ptr)) - @sizeOf(SparcStackFrame)));

        return .{
            .g = uc.mcontext.g,
            .o = uc.mcontext.o,
            .l = frame.l,
            .i = frame.i,
            .pc = uc.mcontext.pc,
        };
    }

    // Only unified conversions from here.
    return switch (native_arch) {
        .arm, .armeb, .thumb, .thumbeb => .{
            .r = uc.mcontext.r ++ [_]u32{uc.mcontext.pc},
        },
        .aarch64, .aarch64_be => .{
            .x = uc.mcontext.x ++ [_]u64{uc.mcontext.lr},
            .sp = uc.mcontext.sp,
            .pc = uc.mcontext.pc,
        },
        .csky => .{
            .r = uc.mcontext.r0_13 ++
                [_]u32{ uc.mcontext.r14, uc.mcontext.r15 } ++
                uc.mcontext.r16_30 ++
                [_]u32{uc.mcontext.r31},
            .pc = uc.mcontext.pc,
        },
        .hexagon, .loongarch32, .loongarch64, .mips, .mipsel, .mips64, .mips64el, .or1k => .{
            .r = uc.mcontext.r,
            .pc = uc.mcontext.pc,
        },
        .m68k => .{
            .d = uc.mcontext.d,
            .a = uc.mcontext.a,
            .pc = uc.mcontext.pc,
        },
        .powerpc, .powerpcle, .powerpc64, .powerpc64le => .{
            .r = uc.mcontext.r,
            .pc = uc.mcontext.pc,
            .lr = uc.mcontext.lr,
        },
        .riscv32, .riscv32be, .riscv64, .riscv64be => .{
            // You can thank FreeBSD and OpenBSD for this silliness; they decided to be cute and
            // group the registers by ABI mnemonic rather than register number.
            .x = [_]Riscv.Gpr{0} ++
                uc.mcontext.ra_sp_gp_tp ++
                uc.mcontext.t0_2 ++
                uc.mcontext.s0_1 ++
                uc.mcontext.a ++
                uc.mcontext.s2_11 ++
                uc.mcontext.t3_6,
            .pc = uc.mcontext.pc,
        },
        .s390x => .{
            .r = uc.mcontext.r,
            .psw = .{
                .mask = uc.mcontext.psw.mask,
                .addr = uc.mcontext.psw.addr,
            },
        },
        .x86 => .{ .gprs = .init(.{
            .eax = uc.mcontext.eax,
            .ecx = uc.mcontext.ecx,
            .edx = uc.mcontext.edx,
            .ebx = uc.mcontext.ebx,
            .esp = uc.mcontext.esp,
            .ebp = uc.mcontext.ebp,
            .esi = uc.mcontext.esi,
            .edi = uc.mcontext.edi,
            .eip = uc.mcontext.eip,
        }) },
        .x86_64 => .{ .gprs = .init(.{
            .rax = uc.mcontext.rax,
            .rdx = uc.mcontext.rdx,
            .rcx = uc.mcontext.rcx,
            .rbx = uc.mcontext.rbx,
            .rsi = uc.mcontext.rsi,
            .rdi = uc.mcontext.rdi,
            .rbp = uc.mcontext.rbp,
            .rsp = uc.mcontext.rsp,
            .r8 = uc.mcontext.r8,
            .r9 = uc.mcontext.r9,
            .r10 = uc.mcontext.r10,
            .r11 = uc.mcontext.r11,
            .r12 = uc.mcontext.r12,
            .r13 = uc.mcontext.r13,
            .r14 = uc.mcontext.r14,
            .r15 = uc.mcontext.r15,
            .rip = uc.mcontext.rip,
        }) },
        else => comptime unreachable,
    };
}

pub fn fromWindowsContext(ctx: *const std.os.windows.CONTEXT) Native {
    return switch (native_arch) {
        .x86 => .{ .gprs = .init(.{
            .eax = ctx.Eax,
            .ecx = ctx.Ecx,
            .edx = ctx.Edx,
            .ebx = ctx.Ebx,
            .esp = ctx.Esp,
            .ebp = ctx.Ebp,
            .esi = ctx.Esi,
            .edi = ctx.Edi,
            .eip = ctx.Eip,
        }) },
        .x86_64 => .{ .gprs = .init(.{
            .rax = ctx.Rax,
            .rdx = ctx.Rdx,
            .rcx = ctx.Rcx,
            .rbx = ctx.Rbx,
            .rsi = ctx.Rsi,
            .rdi = ctx.Rdi,
            .rbp = ctx.Rbp,
            .rsp = ctx.Rsp,
            .r8 = ctx.R8,
            .r9 = ctx.R9,
            .r10 = ctx.R10,
            .r11 = ctx.R11,
            .r12 = ctx.R12,
            .r13 = ctx.R13,
            .r14 = ctx.R14,
            .r15 = ctx.R15,
            .rip = ctx.Rip,
        }) },
        .aarch64 => .{
            .x = ctx.DUMMYUNIONNAME.X[0..31].*,
            .sp = ctx.Sp,
            .pc = ctx.Pc,
        },
        .thumb => .{ .r = .{
            ctx.R0,  ctx.R1, ctx.R2,  ctx.R3,
            ctx.R4,  ctx.R5, ctx.R6,  ctx.R7,
            ctx.R8,  ctx.R9, ctx.R10, ctx.R11,
            ctx.R12, ctx.Sp, ctx.Lr,  ctx.Pc,
        } },
        else => comptime unreachable,
    };
}

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Aarch64 = extern struct {
    /// The numbered general-purpose registers X0 - X30.
    x: [31]u64,
    sp: u64,
    pc: u64,

    pub inline fn current() Aarch64 {
        var ctx: Aarch64 = undefined;
        asm volatile (
            \\ stp x0,  x1,  [x0, #0x000]
            \\ stp x2,  x3,  [x0, #0x010]
            \\ stp x4,  x5,  [x0, #0x020]
            \\ stp x6,  x7,  [x0, #0x030]
            \\ stp x8,  x9,  [x0, #0x040]
            \\ stp x10, x11, [x0, #0x050]
            \\ stp x12, x13, [x0, #0x060]
            \\ stp x14, x15, [x0, #0x070]
            \\ stp x16, x17, [x0, #0x080]
            \\ stp x18, x19, [x0, #0x090]
            \\ stp x20, x21, [x0, #0x0a0]
            \\ stp x22, x23, [x0, #0x0b0]
            \\ stp x24, x25, [x0, #0x0c0]
            \\ stp x26, x27, [x0, #0x0d0]
            \\ stp x28, x29, [x0, #0x0e0]
            \\ str x30, [x0, #0x0f0]
            \\ mov x1, sp
            \\ str x1, [x0, #0x0f8]
            \\ adr x1, .
            \\ str x1, [x0, #0x100]
            :
            : [ctx] "{x0}" (&ctx),
            : .{ .x1 = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Aarch64) u64 {
        return ctx.x[29];
    }
    pub fn getPc(ctx: *const Aarch64) u64 {
        return ctx.pc;
    }

    pub fn dwarfRegisterBytes(ctx: *Aarch64, register_num: u16) DwarfRegisterError![]u8 {
        // DWARF for the Arm(r) 64-bit Architecture (AArch64) § 4.1 "DWARF register names"
        switch (register_num) {
            0...30 => return @ptrCast(&ctx.x[register_num]),
            31 => return @ptrCast(&ctx.sp),
            32 => return @ptrCast(&ctx.pc),

            33 => return error.UnsupportedRegister, // ELR_mode
            34 => return error.UnsupportedRegister, // RA_SIGN_STATE
            35 => return error.UnsupportedRegister, // TPIDRRO_ELO
            36 => return error.UnsupportedRegister, // TPIDR_ELO
            37 => return error.UnsupportedRegister, // TPIDR_EL1
            38 => return error.UnsupportedRegister, // TPIDR_EL2
            39 => return error.UnsupportedRegister, // TPIDR_EL3
            40...45 => return error.UnsupportedRegister, // Reserved
            46 => return error.UnsupportedRegister, // VG
            47 => return error.UnsupportedRegister, // FFR
            48...63 => return error.UnsupportedRegister, // P0 - P15
            64...95 => return error.UnsupportedRegister, // V0 - V31
            96...127 => return error.UnsupportedRegister, // Z0 - Z31

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Arc = extern struct {
    /// The numbered general-purpose registers r0 - r31.
    r: [32]u32,
    pcl: u32,

    pub inline fn current() Arc {
        var ctx: Arc = undefined;
        asm volatile (
            \\ st r0, [r8, 0]
            \\ st r1, [r8, 4]
            \\ st r2, [r8, 8]
            \\ st r3, [r8, 12]
            \\ st r4, [r8, 16]
            \\ st r5, [r8, 20]
            \\ st r6, [r8, 24]
            \\ st r7, [r8, 28]
            \\ st r8, [r8, 32]
            \\ st r9, [r8, 36]
            \\ st r10, [r8, 40]
            \\ st r11, [r8, 44]
            \\ st r12, [r8, 48]
            \\ st r13, [r8, 52]
            \\ st r14, [r8, 56]
            \\ st r15, [r8, 60]
            \\ st r16, [r8, 64]
            \\ st r17, [r8, 68]
            \\ st r18, [r8, 72]
            \\ st r19, [r8, 76]
            \\ st r20, [r8, 80]
            \\ st r21, [r8, 84]
            \\ st r22, [r8, 88]
            \\ st r23, [r8, 92]
            \\ st r24, [r8, 96]
            \\ st r25, [r8, 100]
            \\ st r26, [r8, 104]
            \\ st r27, [r8, 108]
            \\ st r28, [r8, 112]
            \\ st r29, [r8, 116]
            \\ st r30, [r8, 120]
            \\ st r31, [r8, 124]
            \\ st pcl, [r8, 128]
            :
            : [ctx] "{r8}" (&ctx),
            : .{ .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Arc) u32 {
        return ctx.r[27];
    }
    pub fn getPc(ctx: *const Arc) u32 {
        return ctx.pcl;
    }

    pub fn dwarfRegisterBytes(ctx: *Arc, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...31 => return @ptrCast(&ctx.r[register_num]),
            160 => return @ptrCast(&ctx.pcl),

            32...57 => return error.UnsupportedRegister, // Extension Core Registers
            58...127 => return error.UnsupportedRegister, // Reserved
            128...159 => return error.UnsupportedRegister, // f0 - f31

            else => return error.InvalidRegister,
        }
    }
};

const Arm = struct {
    /// The numbered general-purpose registers R0 - R15.
    r: [16]u32,

    pub inline fn current() Arm {
        var ctx: Arm = undefined;
        asm volatile (
            \\ // For compatibility with Thumb, we can't write r13 (sp) or r15 (pc) with stm.
            \\ stm r0, {r0-r12}
            \\ str r13, [r0, #0x34]
            \\ str r14, [r0, #0x38]
            \\ str r15, [r0, #0x3c]
            :
            : [r] "{r0}" (&ctx.r),
            : .{ .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Arm) u32 {
        return ctx.r[11];
    }
    pub fn getPc(ctx: *const Arm) u32 {
        return ctx.r[15];
    }

    pub fn dwarfRegisterBytes(ctx: *Arm, register_num: u16) DwarfRegisterError![]u8 {
        // DWARF for the Arm(r) Architecture § 4.1 "DWARF register names"
        switch (register_num) {
            0...15 => return @ptrCast(&ctx.r[register_num]),

            64...95 => return error.UnsupportedRegister, // S0 - S31
            96...103 => return error.UnsupportedRegister, // F0 - F7
            104...111 => return error.UnsupportedRegister, // wCGR0 - wCGR7, or ACC0 - ACC7
            112...127 => return error.UnsupportedRegister, // wR0 - wR15
            128 => return error.UnsupportedRegister, // SPSR
            129 => return error.UnsupportedRegister, // SPSR_FIQ
            130 => return error.UnsupportedRegister, // SPSR_IRQ
            131 => return error.UnsupportedRegister, // SPSR_ABT
            132 => return error.UnsupportedRegister, // SPSR_UND
            133 => return error.UnsupportedRegister, // SPSR_SVC
            134...142 => return error.UnsupportedRegister, // Reserved
            143 => return error.UnsupportedRegister, // RA_AUTH_CODE
            144...150 => return error.UnsupportedRegister, // R8_USR - R14_USR
            151...157 => return error.UnsupportedRegister, // R8_FIQ - R14_FIQ
            158...159 => return error.UnsupportedRegister, // R13_IRQ - R14_IRQ
            160...161 => return error.UnsupportedRegister, // R13_ABT - R14_ABT
            162...163 => return error.UnsupportedRegister, // R13_UND - R14_UND
            164...165 => return error.UnsupportedRegister, // R13_SVC - R14_SVC
            166...191 => return error.UnsupportedRegister, // Reserved
            192...199 => return error.UnsupportedRegister, // wC0 - wC7
            200...255 => return error.UnsupportedRegister, // Reserved
            256...287 => return error.UnsupportedRegister, // D0 - D31
            288...319 => return error.UnsupportedRegister, // Reserved for FP/NEON
            320 => return error.UnsupportedRegister, // TPIDRURO
            321 => return error.UnsupportedRegister, // TPIDRURW
            322 => return error.UnsupportedRegister, // TPIDPR
            323 => return error.UnsupportedRegister, // HTPIDPR
            324...8191 => return error.UnsupportedRegister, // Reserved
            8192...16383 => return error.UnsupportedRegister, // Unspecified vendor co-processor register

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Csky = extern struct {
    /// The numbered general-purpose registers r0 - r31.
    r: [32]u32,
    pc: u32,

    pub inline fn current() Csky {
        var ctx: Csky = undefined;
        asm volatile (
            \\ stm r0-r31, (t0)
            \\ grs t1, 1f
            \\1:
            \\ st32.w t1, (t0, 128)
            :
            : [ctx] "{r12}" (&ctx),
            : .{ .r13 = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Csky) u32 {
        return ctx.r[14];
    }
    pub fn getPc(ctx: *const Csky) u32 {
        return ctx.pc;
    }

    pub fn dwarfRegisterBytes(ctx: *Csky, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...31 => return @ptrCast(&ctx.r[register_num]),
            64 => return @ptrCast(&ctx.pc),

            32...63 => return error.UnsupportedRegister, // f0 - f31

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Hexagon = extern struct {
    /// The numbered general-purpose registers r0 - r31.
    r: [32]u32,
    pc: u32,

    pub inline fn current() Hexagon {
        var ctx: Hexagon = undefined;
        asm volatile (
            \\ memw(r0 + #0) = r0
            \\ memw(r0 + #4) = r1
            \\ memw(r0 + #8) = r2
            \\ memw(r0 + #12) = r3
            \\ memw(r0 + #16) = r4
            \\ memw(r0 + #20) = r5
            \\ memw(r0 + #24) = r6
            \\ memw(r0 + #28) = r7
            \\ memw(r0 + #32) = r8
            \\ memw(r0 + #36) = r9
            \\ memw(r0 + #40) = r10
            \\ memw(r0 + #44) = r11
            \\ memw(r0 + #48) = r12
            \\ memw(r0 + #52) = r13
            \\ memw(r0 + #56) = r14
            \\ memw(r0 + #60) = r15
            \\ memw(r0 + #64) = r16
            \\ memw(r0 + #68) = r17
            \\ memw(r0 + #72) = r18
            \\ memw(r0 + #76) = r19
            \\ memw(r0 + #80) = r20
            \\ memw(r0 + #84) = r21
            \\ memw(r0 + #88) = r22
            \\ memw(r0 + #92) = r23
            \\ memw(r0 + #96) = r24
            \\ memw(r0 + #100) = r25
            \\ memw(r0 + #104) = r26
            \\ memw(r0 + #108) = r27
            \\ memw(r0 + #112) = r28
            \\ memw(r0 + #116) = r29
            \\ memw(r0 + #120) = r30
            \\ memw(r0 + #124) = r31
            \\ r1 = pc
            \\ memw(r0 + #128) = r1
            :
            : [ctx] "{r0}" (&ctx),
            : .{ .r1 = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Hexagon) u32 {
        return ctx.r[30];
    }
    pub fn getPc(ctx: *const Hexagon) u32 {
        return ctx.pc;
    }

    pub fn dwarfRegisterBytes(ctx: *Hexagon, register_num: u16) DwarfRegisterError![]u8 {
        // Sourced from LLVM's HexagonRegisterInfo.td, which disagrees with LLDB...
        switch (register_num) {
            0...31 => return @ptrCast(&ctx.r[register_num]),
            76 => return @ptrCast(&ctx.pc),

            // This is probably covering some numbers that aren't actually mapped, but seriously,
            // look at that file. I really can't be bothered to make it more precise.
            32...75 => return error.UnsupportedRegister,
            77...259 => return error.UnsupportedRegister,
            // 999999...1000030 => return error.UnsupportedRegister,
            // 9999999...10000030 => return error.UnsupportedRegister,

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Kvx = extern struct {
    r: [64]u64,
    ra: u64,
    pc: u64,

    pub inline fn current() Kvx {
        var ctx: Kvx = undefined;
        asm volatile (
            \\ so (0)[$r32] = $r0r1r2r3
            \\ ;;
            \\ so (32)[$r32] = $r4r5r6r7
            \\ ;;
            \\ so (64)[$r32] = $r8r9r10r11
            \\ ;;
            \\ so (96)[$r32] = $r12r13r14r15
            \\ ;;
            \\ so (128)[$r32] = $r16r17r18r19
            \\ ;;
            \\ so (160)[$r32] = $r20r21r22r23
            \\ ;;
            \\ so (192)[$r32] = $r24r25r26r27
            \\ ;;
            \\ so (224)[$r32] = $r28r29r30r31
            \\ ;;
            \\ so (256)[$r32] = $r32r33r34r35
            \\ ;;
            \\ so (288)[$r32] = $r36r37r38r39
            \\ ;;
            \\ so (320)[$r32] = $r40r41r42r43
            \\ ;;
            \\ so (352)[$r32] = $r44r45r46r47
            \\ ;;
            \\ so (384)[$r32] = $r48r49r50r51
            \\ ;;
            \\ so (416)[$r32] = $r52r53r54r55
            \\ ;;
            \\ so (448)[$r32] = $r56r57r58r59
            \\ get $r34 = $pc
            \\ ;;
            \\ so (480)[$r32] = $r60r61r62r63
            \\ get $r35 = $ra
            \\ ;;
            \\ sq (512)[$r32] = $r34r35
            :
            : [ctx] "{r32}" (&ctx),
            : .{ .r34 = true, .r35 = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Kvx) u64 {
        return ctx.r[14];
    }
    pub fn getPc(ctx: *const Kvx) u64 {
        return ctx.pc;
    }

    pub fn dwarfRegisterBytes(ctx: *Kvx, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...63 => return @ptrCast(&ctx.r[register_num]),
            64 => return @ptrCast(&ctx.pc),
            67 => return @ptrCast(&ctx.ra),

            65...66 => return error.UnsupportedRegister, // SFRs
            68...255 => return error.UnsupportedRegister, // SFRs
            256...767 => return error.UnsupportedRegister, // XCRs

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Lanai = extern struct {
    r: [32]u32,

    pub inline fn current() Lanai {
        var ctx: Lanai = undefined;
        asm volatile (
            \\ st %%r0, 0[r9]
            \\ st %%r1, 4[r9]
            \\ st %%r2, 8[r9]
            \\ st %%r3, 12[r9]
            \\ st %%r4, 16[r9]
            \\ st %%r5, 20[r9]
            \\ st %%r6, 24[r9]
            \\ st %%r7, 28[r9]
            \\ st %%r8, 32[r9]
            \\ st %%r9, 36[r9]
            \\ st %%r10, 40[r9]
            \\ st %%r11, 44[r9]
            \\ st %%r12, 48[r9]
            \\ st %%r13, 52[r9]
            \\ st %%r14, 56[r9]
            \\ st %%r15, 60[r9]
            \\ st %%r16, 64[r9]
            \\ st %%r17, 68[r9]
            \\ st %%r18, 72[r9]
            \\ st %%r19, 76[r9]
            \\ st %%r20, 80[r9]
            \\ st %%r21, 84[r9]
            \\ st %%r22, 88[r9]
            \\ st %%r23, 92[r9]
            \\ st %%r24, 96[r9]
            \\ st %%r25, 100[r9]
            \\ st %%r26, 104[r9]
            \\ st %%r27, 108[r9]
            \\ st %%r28, 112[r9]
            \\ st %%r29, 116[r9]
            \\ st %%r30, 120[r9]
            \\ st %%r31, 124[r9]
            :
            : [ctx] "{r9}" (&ctx),
            : .{ .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Lanai) u32 {
        return ctx.r[5];
    }
    pub fn getPc(ctx: *const Lanai) u32 {
        return ctx.r[2];
    }

    pub fn dwarfRegisterBytes(ctx: *Lanai, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...31 => return @ptrCast(&ctx.s[register_num]),

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const LoongArch = extern struct {
    /// The numbered general-purpose registers r0 - r31. r0 must be zero.
    r: [32]Gpr,
    pc: Gpr,

    pub const Gpr = if (native_arch == .loongarch64) u64 else u32;

    pub inline fn current() LoongArch {
        var ctx: LoongArch = undefined;
        asm volatile (if (Gpr == u64)
                \\ st.d $zero, $t0, 0
                \\ st.d $ra, $t0, 8
                \\ st.d $tp, $t0, 16
                \\ st.d $sp, $t0, 24
                \\ st.d $a0, $t0, 32
                \\ st.d $a1, $t0, 40
                \\ st.d $a2, $t0, 48
                \\ st.d $a3, $t0, 56
                \\ st.d $a4, $t0, 64
                \\ st.d $a5, $t0, 72
                \\ st.d $a6, $t0, 80
                \\ st.d $a7, $t0, 88
                \\ st.d $t0, $t0, 96
                \\ st.d $t1, $t0, 104
                \\ st.d $t2, $t0, 112
                \\ st.d $t3, $t0, 120
                \\ st.d $t4, $t0, 128
                \\ st.d $t5, $t0, 136
                \\ st.d $t6, $t0, 144
                \\ st.d $t7, $t0, 152
                \\ st.d $t8, $t0, 160
                \\ st.d $r21, $t0, 168
                \\ st.d $fp, $t0, 176
                \\ st.d $s0, $t0, 184
                \\ st.d $s1, $t0, 192
                \\ st.d $s2, $t0, 200
                \\ st.d $s3, $t0, 208
                \\ st.d $s4, $t0, 216
                \\ st.d $s5, $t0, 224
                \\ st.d $s6, $t0, 232
                \\ st.d $s7, $t0, 240
                \\ st.d $s8, $t0, 248
                \\ bl 1f
                \\1:
                \\ st.d $ra, $t0, 256
            else
                \\ st.w $zero, $t0, 0
                \\ st.w $ra, $t0, 4
                \\ st.w $tp, $t0, 8
                \\ st.w $sp, $t0, 12
                \\ st.w $a0, $t0, 16
                \\ st.w $a1, $t0, 20
                \\ st.w $a2, $t0, 24
                \\ st.w $a3, $t0, 28
                \\ st.w $a4, $t0, 32
                \\ st.w $a5, $t0, 36
                \\ st.w $a6, $t0, 40
                \\ st.w $a7, $t0, 44
                \\ st.w $t0, $t0, 48
                \\ st.w $t1, $t0, 52
                \\ st.w $t2, $t0, 56
                \\ st.w $t3, $t0, 60
                \\ st.w $t4, $t0, 64
                \\ st.w $t5, $t0, 68
                \\ st.w $t6, $t0, 72
                \\ st.w $t7, $t0, 76
                \\ st.w $t8, $t0, 80
                \\ st.w $r21, $t0, 84
                \\ st.w $fp, $t0, 88
                \\ st.w $s0, $t0, 92
                \\ st.w $s1, $t0, 96
                \\ st.w $s2, $t0, 100
                \\ st.w $s3, $t0, 104
                \\ st.w $s4, $t0, 108
                \\ st.w $s5, $t0, 112
                \\ st.w $s6, $t0, 116
                \\ st.w $s7, $t0, 120
                \\ st.w $s8, $t0, 124
                \\ bl 1f
                \\1:
                \\ st.w $ra, $t0, 128
            :
            : [ctx] "{$r12}" (&ctx),
            : .{ .r1 = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const LoongArch) Gpr {
        return ctx.r[22];
    }
    pub fn getPc(ctx: *const LoongArch) Gpr {
        return ctx.pc;
    }

    pub fn dwarfRegisterBytes(ctx: *LoongArch, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...31 => return @ptrCast(&ctx.r[register_num]),
            64 => return @ptrCast(&ctx.pc),

            32...63 => return error.UnsupportedRegister, // f0 - f31

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const M68k = extern struct {
    /// The numbered data registers d0 - d7.
    d: [8]u32,
    /// The numbered address registers a0 - a7.
    a: [8]u32,
    pc: u32,

    pub inline fn current() M68k {
        var ctx: M68k = undefined;
        asm volatile (
            \\ movem.l %%d0 - %%a7, (%%a0)
            \\ lea.l (%%pc), %%a1
            \\ move.l %%a1, (%%a0, 64)
            :
            : [ctx] "{a0}" (&ctx),
            : .{ .a1 = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const M68k) u32 {
        return ctx.a[6];
    }
    pub fn getPc(ctx: *const M68k) u32 {
        return ctx.pc;
    }

    pub fn dwarfRegisterBytes(ctx: *M68k, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...7 => return @ptrCast(&ctx.d[register_num]),
            8...15 => return @ptrCast(&ctx.a[register_num - 8]),
            26 => return @ptrCast(&ctx.pc),

            16...23 => return error.UnsupportedRegister, // fp0 - fp7
            24...25 => return error.UnsupportedRegister, // Return columns in GCC...?

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Mips = extern struct {
    /// The numbered general-purpose registers r0 - r31. r0 must be zero.
    r: [32]Gpr,
    pc: Gpr,

    pub const Gpr = if (native_arch.isMIPS64()) u64 else u32;

    pub inline fn current() Mips {
        var ctx: Mips = undefined;
        asm volatile (if (Gpr == u64)
                \\ .set push
                \\ .set noat
                \\ .set noreorder
                \\ .set nomacro
                \\ sd $zero, 0($t0)
                \\ sd $at, 8($t0)
                \\ sd $v0, 16($t0)
                \\ sd $v1, 24($t0)
                \\ sd $a0, 32($t0)
                \\ sd $a1, 40($t0)
                \\ sd $a2, 48($t0)
                \\ sd $a3, 56($t0)
                \\ sd $a4, 64($t0)
                \\ sd $a5, 72($t0)
                \\ sd $a6, 80($t0)
                \\ sd $a7, 88($t0)
                \\ sd $t0, 96($t0)
                \\ sd $t1, 104($t0)
                \\ sd $t2, 112($t0)
                \\ sd $t3, 120($t0)
                \\ sd $s0, 128($t0)
                \\ sd $s1, 136($t0)
                \\ sd $s2, 144($t0)
                \\ sd $s3, 152($t0)
                \\ sd $s4, 160($t0)
                \\ sd $s5, 168($t0)
                \\ sd $s6, 176($t0)
                \\ sd $s7, 184($t0)
                \\ sd $t8, 192($t0)
                \\ sd $t9, 200($t0)
                \\ sd $k0, 208($t0)
                \\ sd $k1, 216($t0)
                \\ sd $gp, 224($t0)
                \\ sd $sp, 232($t0)
                \\ sd $fp, 240($t0)
                \\ sd $ra, 248($t0)
                \\ bal 1f
                \\1:
                \\ sd $ra, 256($t0)
                \\ .set pop
            else
                \\ .set push
                \\ .set noat
                \\ .set noreorder
                \\ .set nomacro
                \\ sw $zero, 0($t4)
                \\ sw $at, 4($t4)
                \\ sw $v0, 8($t4)
                \\ sw $v1, 12($t4)
                \\ sw $a0, 16($t4)
                \\ sw $a1, 20($t4)
                \\ sw $a2, 24($t4)
                \\ sw $a3, 28($t4)
                \\ sw $t0, 32($t4)
                \\ sw $t1, 36($t4)
                \\ sw $t2, 40($t4)
                \\ sw $t3, 44($t4)
                \\ sw $t4, 48($t4)
                \\ sw $t5, 52($t4)
                \\ sw $t6, 56($t4)
                \\ sw $t7, 60($t4)
                \\ sw $s0, 64($t4)
                \\ sw $s1, 68($t4)
                \\ sw $s2, 72($t4)
                \\ sw $s3, 76($t4)
                \\ sw $s4, 80($t4)
                \\ sw $s5, 84($t4)
                \\ sw $s6, 88($t4)
                \\ sw $s7, 92($t4)
                \\ sw $t8, 96($t4)
                \\ sw $t9, 100($t4)
                \\ sw $k0, 104($t4)
                \\ sw $k1, 108($t4)
                \\ sw $gp, 112($t4)
                \\ sw $sp, 116($t4)
                \\ sw $fp, 120($t4)
                \\ sw $ra, 124($t4)
                \\ bal 1f
                \\1:
                \\ sw $ra, 128($t4)
                \\ .set pop
            :
            : [ctx] "{$12}" (&ctx),
            : .{ .r31 = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Mips) usize {
        // On N32, `Gpr` is 64 bits but `usize` is 32 bits.
        return @intCast(ctx.r[30]);
    }
    pub fn getPc(ctx: *const Mips) usize {
        // On N32, `Gpr` is 64 bits but `usize` is 32 bits.
        return @intCast(ctx.pc);
    }

    pub fn dwarfRegisterBytes(ctx: *Mips, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...31 => return @ptrCast(&ctx.r[register_num]),
            66 => return @ptrCast(&ctx.pc),

            // Who the hell knows what numbers exist for this architecture? What's an ABI
            // specification anyway? We don't need that nonsense.
            32...63 => return error.UnsupportedRegister, // f0 - f31, w0 - w31
            64 => return error.UnsupportedRegister, // hi0 (ac0)
            65 => return error.UnsupportedRegister, // lo0 (ac0)
            176 => return error.UnsupportedRegister, // hi1 (ac1)
            177 => return error.UnsupportedRegister, // lo1 (ac1)
            178 => return error.UnsupportedRegister, // hi2 (ac2)
            179 => return error.UnsupportedRegister, // lo2 (ac2)
            180 => return error.UnsupportedRegister, // hi3 (ac3)
            181 => return error.UnsupportedRegister, // lo3 (ac3)

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Or1k = extern struct {
    /// The numbered general-purpose registers r0 - r31.
    r: [32]u32,
    pc: u32,

    pub inline fn current() Or1k {
        var ctx: Or1k = undefined;
        asm volatile (
            \\ l.sw 0(r15), r0
            \\ l.sw 4(r15), r1
            \\ l.sw 8(r15), r2
            \\ l.sw 12(r15), r3
            \\ l.sw 16(r15), r4
            \\ l.sw 20(r15), r5
            \\ l.sw 24(r15), r6
            \\ l.sw 28(r15), r7
            \\ l.sw 32(r15), r8
            \\ l.sw 36(r15), r9
            \\ l.sw 40(r15), r10
            \\ l.sw 44(r15), r11
            \\ l.sw 48(r15), r12
            \\ l.sw 52(r15), r13
            \\ l.sw 56(r15), r14
            \\ l.sw 60(r15), r15
            \\ l.sw 64(r15), r16
            \\ l.sw 68(r15), r17
            \\ l.sw 72(r15), r18
            \\ l.sw 76(r15), r19
            \\ l.sw 80(r15), r20
            \\ l.sw 84(r15), r21
            \\ l.sw 88(r15), r22
            \\ l.sw 92(r15), r23
            \\ l.sw 96(r15), r24
            \\ l.sw 100(r15), r25
            \\ l.sw 104(r15), r26
            \\ l.sw 108(r15), r27
            \\ l.sw 112(r15), r28
            \\ l.sw 116(r15), r29
            \\ l.sw 120(r15), r30
            \\ l.sw 124(r15), r31
            \\ l.jal 1f
            \\1:
            \\ l.sw 128(r15), r9
            :
            : [ctx] "{r15}" (&ctx),
            : .{ .r9 = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Or1k) u32 {
        return ctx.r[2];
    }
    pub fn getPc(ctx: *const Or1k) u32 {
        return ctx.pc;
    }

    pub fn dwarfRegisterBytes(ctx: *Or1k, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...31 => return @ptrCast(&ctx.r[register_num]),
            35 => return @ptrCast(&ctx.pc),

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Powerpc = extern struct {
    /// The numbered general-purpose registers r0 - r31.
    r: [32]Gpr,
    pc: Gpr,
    lr: Gpr,

    pub const Gpr = if (native_arch.isPowerPC64()) u64 else u32;

    pub inline fn current() Powerpc {
        var ctx: Powerpc = undefined;
        asm volatile (if (Gpr == u64)
                \\ std 0, 0(10)
                \\ std 1, 8(10)
                \\ std 2, 16(10)
                \\ std 3, 24(10)
                \\ std 4, 32(10)
                \\ std 5, 40(10)
                \\ std 6, 48(10)
                \\ std 7, 56(10)
                \\ std 8, 64(10)
                \\ std 9, 72(10)
                \\ std 10, 80(10)
                \\ std 11, 88(10)
                \\ std 12, 96(10)
                \\ std 13, 104(10)
                \\ std 14, 112(10)
                \\ std 15, 120(10)
                \\ std 16, 128(10)
                \\ std 17, 136(10)
                \\ std 18, 144(10)
                \\ std 19, 152(10)
                \\ std 20, 160(10)
                \\ std 21, 168(10)
                \\ std 22, 176(10)
                \\ std 23, 184(10)
                \\ std 24, 192(10)
                \\ std 25, 200(10)
                \\ std 26, 208(10)
                \\ std 27, 216(10)
                \\ std 28, 224(10)
                \\ std 29, 232(10)
                \\ std 30, 240(10)
                \\ std 31, 248(10)
                \\ mflr 8
                \\ std 8, 264(10)
                \\ bl 1f
                \\1:
                \\ mflr 8
                \\ std 8, 256(10)
            else
                \\ stw 0, 0(10)
                \\ stw 1, 4(10)
                \\ stw 2, 8(10)
                \\ stw 3, 12(10)
                \\ stw 4, 16(10)
                \\ stw 5, 20(10)
                \\ stw 6, 24(10)
                \\ stw 7, 28(10)
                \\ stw 8, 32(10)
                \\ stw 9, 36(10)
                \\ stw 10, 40(10)
                \\ stw 11, 44(10)
                \\ stw 12, 48(10)
                \\ stw 13, 52(10)
                \\ stw 14, 56(10)
                \\ stw 15, 60(10)
                \\ stw 16, 64(10)
                \\ stw 17, 68(10)
                \\ stw 18, 72(10)
                \\ stw 19, 76(10)
                \\ stw 20, 80(10)
                \\ stw 21, 84(10)
                \\ stw 22, 88(10)
                \\ stw 23, 92(10)
                \\ stw 24, 96(10)
                \\ stw 25, 100(10)
                \\ stw 26, 104(10)
                \\ stw 27, 108(10)
                \\ stw 28, 112(10)
                \\ stw 29, 116(10)
                \\ stw 30, 120(10)
                \\ stw 31, 124(10)
                \\ mflr 8
                \\ stw 8, 132(10)
                \\ bl 1f
                \\1:
                \\ mflr 8
                \\ stw 8, 128(10)
            :
            : [ctx] "{r10}" (&ctx),
            : .{ .r8 = true, .lr = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Powerpc) Gpr {
        return ctx.r[1];
    }
    pub fn getPc(ctx: *const Powerpc) Gpr {
        return ctx.pc;
    }

    pub fn dwarfRegisterBytes(ctx: *Powerpc, register_num: u16) DwarfRegisterError![]u8 {
        // References:
        //
        // * System V Application Binary Interface - PowerPC Processor Supplement §3-46
        // * Power Architecture 32-bit Application Binary Interface Supplement 1.0 - Linux & Embedded §3.4
        // * 64-bit ELF V2 ABI Specification - Power Architecture Revision 1.5 §2.4
        //
        // Are we having fun yet?

        if (Gpr == u64) switch (register_num) {
            65 => return @ptrCast(&ctx.lr), // lr

            66 => return error.UnsupportedRegister, // ctr
            68...75 => return error.UnsupportedRegister, // cr0 - cr7
            76 => return error.UnsupportedRegister, // xer
            77...108 => return error.UnsupportedRegister, // vr0 - vr31
            109 => return error.UnsupportedRegister, // vrsave (LLVM)
            110 => return error.UnsupportedRegister, // vscr
            114 => return error.UnsupportedRegister, // tfhar
            115 => return error.UnsupportedRegister, // tfiar
            116 => return error.UnsupportedRegister, // texasr

            else => {},
        } else switch (register_num) {
            65 => return @ptrCast(&ctx.lr), // fpscr (SVR4 / EABI), or lr if you ask LLVM
            108 => return @ptrCast(&ctx.lr),

            64 => return error.UnsupportedRegister, // cr
            66 => return error.UnsupportedRegister, // msr (SVR4 / EABI), or ctr if you ask LLVM
            68...75 => return error.UnsupportedRegister, // cr0 - cr7 if you ask LLVM
            76 => return error.UnsupportedRegister, // xer if you ask LLVM
            99 => return error.UnsupportedRegister, // acc
            100 => return error.UnsupportedRegister, // mq
            101 => return error.UnsupportedRegister, // xer
            102...107 => return error.UnsupportedRegister, // SPRs
            109 => return error.UnsupportedRegister, // ctr
            110...111 => return error.UnsupportedRegister, // SPRs
            112 => return error.UnsupportedRegister, // spefscr
            113...1123 => return error.UnsupportedRegister, // SPRs
            1124...1155 => return error.UnsupportedRegister, // SPE v0 - v31
            1200...1231 => return error.UnsupportedRegister, // SPE upper r0 - r31
            3072...4095 => return error.UnsupportedRegister, // DCRs
            4096...5120 => return error.UnsupportedRegister, // PMRs

            else => {},
        }

        switch (register_num) {
            0...31 => return @ptrCast(&ctx.r[register_num]),
            67 => return @ptrCast(&ctx.pc),

            32...63 => return error.UnsupportedRegister, // f0 - f31

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Riscv = extern struct {
    /// The numbered general-purpose registers r0 - r31. r0 must be zero.
    x: [32]Gpr,
    pc: Gpr,

    pub const Gpr = if (native_arch.isRiscv64()) u64 else u32;

    pub inline fn current() Riscv {
        var ctx: Riscv = undefined;
        asm volatile (if (Gpr == u64)
                \\ sd zero, 0(t0)
                \\ sd ra, 8(t0)
                \\ sd sp, 16(t0)
                \\ sd gp, 24(t0)
                \\ sd tp, 32(t0)
                \\ sd t0, 40(t0)
                \\ sd t1, 48(t0)
                \\ sd t2, 56(t0)
                \\ sd s0, 64(t0)
                \\ sd s1, 72(t0)
                \\ sd a0, 80(t0)
                \\ sd a1, 88(t0)
                \\ sd a2, 96(t0)
                \\ sd a3, 104(t0)
                \\ sd a4, 112(t0)
                \\ sd a5, 120(t0)
                \\ sd a6, 128(t0)
                \\ sd a7, 136(t0)
                \\ sd s2, 144(t0)
                \\ sd s3, 152(t0)
                \\ sd s4, 160(t0)
                \\ sd s5, 168(t0)
                \\ sd s6, 176(t0)
                \\ sd s7, 184(t0)
                \\ sd s8, 192(t0)
                \\ sd s9, 200(t0)
                \\ sd s10, 208(t0)
                \\ sd s11, 216(t0)
                \\ sd t3, 224(t0)
                \\ sd t4, 232(t0)
                \\ sd t5, 240(t0)
                \\ sd t6, 248(t0)
                \\ jal ra, 1f
                \\1:
                \\ sd ra, 256(t0)
            else
                \\ sw zero, 0(t0)
                \\ sw ra, 4(t0)
                \\ sw sp, 8(t0)
                \\ sw gp, 12(t0)
                \\ sw tp, 16(t0)
                \\ sw t0, 20(t0)
                \\ sw t1, 24(t0)
                \\ sw t2, 28(t0)
                \\ sw s0, 32(t0)
                \\ sw s1, 36(t0)
                \\ sw a0, 40(t0)
                \\ sw a1, 44(t0)
                \\ sw a2, 48(t0)
                \\ sw a3, 52(t0)
                \\ sw a4, 56(t0)
                \\ sw a5, 60(t0)
                \\ sw a6, 64(t0)
                \\ sw a7, 68(t0)
                \\ sw s2, 72(t0)
                \\ sw s3, 76(t0)
                \\ sw s4, 80(t0)
                \\ sw s5, 84(t0)
                \\ sw s6, 88(t0)
                \\ sw s7, 92(t0)
                \\ sw s8, 96(t0)
                \\ sw s9, 100(t0)
                \\ sw s10, 104(t0)
                \\ sw s11, 108(t0)
                \\ sw t3, 112(t0)
                \\ sw t4, 116(t0)
                \\ sw t5, 120(t0)
                \\ sw t6, 124(t0)
                \\ jal ra, 1f
                \\1:
                \\ sw ra, 128(t0)
            :
            : [ctx] "{t0}" (&ctx),
            : .{ .x1 = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Riscv) Gpr {
        return ctx.x[8];
    }
    pub fn getPc(ctx: *const Riscv) Gpr {
        return ctx.pc;
    }

    pub fn dwarfRegisterBytes(ctx: *Riscv, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...31 => return @ptrCast(&ctx.x[register_num]),
            65 => return @ptrCast(&ctx.pc),

            32...63 => return error.UnsupportedRegister, // f0 - f31
            64 => return error.UnsupportedRegister, // Alternate Frame Return Column
            96...127 => return error.UnsupportedRegister, // v0 - v31
            3072...4095 => return error.UnsupportedRegister, // Custom extensions
            4096...8191 => return error.UnsupportedRegister, // CSRs

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const S390x = extern struct {
    /// The numbered general-purpose registers r0 - r15.
    r: [16]u64,
    /// The program counter.
    psw: extern struct {
        mask: u64,
        addr: u64,
    },

    pub inline fn current() S390x {
        var ctx: S390x = undefined;
        asm volatile (
            \\ stmg %%r0, %%r15, 0(%%r2)
            \\ epsw %%r0, %%r1
            \\ stm %%r0, %%r1, 128(%%r2)
            \\ larl %%r0, .
            \\ stg %%r0, 136(%%r2)
            :
            : [ctx] "{r2}" (&ctx),
            : .{ .r0 = true, .r1 = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const S390x) u64 {
        return ctx.r[11];
    }
    pub fn getPc(ctx: *const S390x) u64 {
        return ctx.psw.addr;
    }

    pub fn dwarfRegisterBytes(ctx: *S390x, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...15 => return @ptrCast(&ctx.r[register_num]),
            64 => return @ptrCast(&ctx.psw.mask),
            65 => return @ptrCast(&ctx.psw.addr),

            16...31 => return error.UnsupportedRegister, // f0 - f15
            32...47 => return error.UnsupportedRegister, // cr0 - cr15
            48...63 => return error.UnsupportedRegister, // a0 - a15
            66...67 => return error.UnsupportedRegister, // z/OS stuff???
            68...83 => return error.UnsupportedRegister, // v16 - v31

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Sparc = extern struct {
    g: [8]Gpr,
    o: [8]Gpr,
    l: [8]Gpr,
    i: [8]Gpr,
    pc: Gpr,

    pub const Gpr = if (native_arch == .sparc64) u64 else u32;

    pub inline fn current() Sparc {
        flushWindows();

        var ctx: Sparc = undefined;
        asm volatile (if (Gpr == u64)
                \\ stx %g0, [%l0 + 0]
                \\ stx %g1, [%l0 + 8]
                \\ stx %g2, [%l0 + 16]
                \\ stx %g3, [%l0 + 24]
                \\ stx %g4, [%l0 + 32]
                \\ stx %g5, [%l0 + 40]
                \\ stx %g6, [%l0 + 48]
                \\ stx %g7, [%l0 + 56]
                \\ stx %o0, [%l0 + 64]
                \\ stx %o1, [%l0 + 72]
                \\ stx %o2, [%l0 + 80]
                \\ stx %o3, [%l0 + 88]
                \\ stx %o4, [%l0 + 96]
                \\ stx %o5, [%l0 + 104]
                \\ stx %o6, [%l0 + 112]
                \\ stx %o7, [%l0 + 120]
                \\ stx %l0, [%l0 + 128]
                \\ stx %l1, [%l0 + 136]
                \\ stx %l2, [%l0 + 144]
                \\ stx %l3, [%l0 + 152]
                \\ stx %l4, [%l0 + 160]
                \\ stx %l5, [%l0 + 168]
                \\ stx %l6, [%l0 + 176]
                \\ stx %l7, [%l0 + 184]
                \\ stx %i0, [%l0 + 192]
                \\ stx %i1, [%l0 + 200]
                \\ stx %i2, [%l0 + 208]
                \\ stx %i3, [%l0 + 216]
                \\ stx %i4, [%l0 + 224]
                \\ stx %i5, [%l0 + 232]
                \\ stx %i6, [%l0 + 240]
                \\ stx %i7, [%l0 + 248]
                \\ call 1f
                \\1:
                \\ stx %o7, [%l0 + 256]
            else
                \\ std %g0, [%l0 + 0]
                \\ std %g2, [%l0 + 8]
                \\ std %g4, [%l0 + 16]
                \\ std %g6, [%l0 + 24]
                \\ std %o0, [%l0 + 32]
                \\ std %o2, [%l0 + 40]
                \\ std %o4, [%l0 + 48]
                \\ std %o6, [%l0 + 56]
                \\ std %l0, [%l0 + 64]
                \\ std %l2, [%l0 + 72]
                \\ std %l4, [%l0 + 80]
                \\ std %l6, [%l0 + 88]
                \\ std %i0, [%l0 + 96]
                \\ std %i2, [%l0 + 104]
                \\ std %i4, [%l0 + 112]
                \\ std %i6, [%l0 + 120]
                \\ call 1f
                \\1:
                \\ st %o7, [%l0 + 128]
            :
            : [ctx] "{l0}" (&ctx),
            : .{ .o7 = true, .memory = true });
        return ctx;
    }

    noinline fn flushWindows() void {
        // Flush all register windows except the current one (hence `noinline`). This ensures that
        // we actually see meaningful data on the stack when we walk the frame chain.
        if (comptime builtin.target.cpu.has(.sparc, .v9))
            asm volatile ("flushw" ::: .{ .memory = true })
        else
            asm volatile ("ta 3" ::: .{ .memory = true }); // ST_FLUSH_WINDOWS
    }

    pub fn getFp(ctx: *const Sparc) Gpr {
        return ctx.i[6];
    }
    pub fn getPc(ctx: *const Sparc) Gpr {
        return ctx.pc;
    }

    pub fn dwarfRegisterBytes(ctx: *Sparc, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...7 => return @ptrCast(&ctx.g[register_num]),
            8...15 => return @ptrCast(&ctx.o[register_num - 8]),
            16...23 => return @ptrCast(&ctx.l[register_num - 16]),
            24...31 => return @ptrCast(&ctx.i[register_num - 24]),
            32 => return @ptrCast(&ctx.pc),

            else => return error.InvalidRegister,
        }
    }
};

/// This is an `extern struct` so that inline assembly in `current` can use field offsets.
const Ve = extern struct {
    s: [64]u64,
    ic: u64,

    pub inline fn current() Ve {
        var ctx: Ve = undefined;
        asm volatile (
            \\ st %%s0, 0(, %%s8)
            \\ st %%s1, 8(, %%s8)
            \\ st %%s2, 16(, %%s8)
            \\ st %%s3, 24(, %%s8)
            \\ st %%s4, 32(, %%s8)
            \\ st %%s5, 40(, %%s8)
            \\ st %%s6, 48(, %%s8)
            \\ st %%s7, 56(, %%s8)
            \\ st %%s8, 64(, %%s8)
            \\ st %%s9, 72(, %%s8)
            \\ st %%s10, 80(, %%s8)
            \\ st %%s11, 88(, %%s8)
            \\ st %%s12, 96(, %%s8)
            \\ st %%s13, 104(, %%s8)
            \\ st %%s14, 112(, %%s8)
            \\ st %%s15, 120(, %%s8)
            \\ st %%s16, 128(, %%s8)
            \\ st %%s17, 136(, %%s8)
            \\ st %%s18, 144(, %%s8)
            \\ st %%s19, 152(, %%s8)
            \\ st %%s20, 160(, %%s8)
            \\ st %%s21, 168(, %%s8)
            \\ st %%s22, 176(, %%s8)
            \\ st %%s23, 184(, %%s8)
            \\ st %%s24, 192(, %%s8)
            \\ st %%s25, 200(, %%s8)
            \\ st %%s26, 208(, %%s8)
            \\ st %%s27, 216(, %%s8)
            \\ st %%s28, 224(, %%s8)
            \\ st %%s29, 232(, %%s8)
            \\ st %%s30, 240(, %%s8)
            \\ st %%s31, 248(, %%s8)
            \\ st %%s32, 256(, %%s8)
            \\ st %%s33, 264(, %%s8)
            \\ st %%s34, 272(, %%s8)
            \\ st %%s35, 280(, %%s8)
            \\ st %%s36, 288(, %%s8)
            \\ st %%s37, 296(, %%s8)
            \\ st %%s38, 304(, %%s8)
            \\ st %%s39, 312(, %%s8)
            \\ st %%s40, 320(, %%s8)
            \\ st %%s41, 328(, %%s8)
            \\ st %%s42, 336(, %%s8)
            \\ st %%s43, 344(, %%s8)
            \\ st %%s44, 352(, %%s8)
            \\ st %%s45, 360(, %%s8)
            \\ st %%s46, 368(, %%s8)
            \\ st %%s47, 376(, %%s8)
            \\ st %%s48, 384(, %%s8)
            \\ st %%s49, 392(, %%s8)
            \\ st %%s50, 400(, %%s8)
            \\ st %%s51, 408(, %%s8)
            \\ st %%s52, 416(, %%s8)
            \\ st %%s53, 424(, %%s8)
            \\ st %%s54, 432(, %%s8)
            \\ st %%s55, 440(, %%s8)
            \\ st %%s56, 448(, %%s8)
            \\ st %%s57, 456(, %%s8)
            \\ st %%s58, 464(, %%s8)
            \\ st %%s59, 472(, %%s8)
            \\ st %%s60, 480(, %%s8)
            \\ st %%s61, 488(, %%s8)
            \\ st %%s62, 496(, %%s8)
            \\ st %%s63, 504(, %%s8)
            \\ br.l 1f
            \\1:
            \\ st %%lr, 512(, %%s8)
            :
            : [ctx] "{s8}" (&ctx),
            : .{ .s10 = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const Ve) u64 {
        return ctx.s[9];
    }
    pub fn getPc(ctx: *const Ve) u64 {
        return ctx.ic;
    }

    pub fn dwarfRegisterBytes(ctx: *Ve, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            0...63 => return @ptrCast(&ctx.s[register_num]),
            144 => return @ptrCast(&ctx.ic),

            64...127 => return error.UnsupportedRegister, // v0 - v63
            128...143 => return error.UnsupportedRegister, // vm0 - vm15

            else => return error.InvalidRegister,
        }
    }
};

const X86_16 = struct {
    pub const Register = enum {
        // zig fmt: off
        sp, bp, ss,
        ip, cs,
        // zig fmt: on
    };

    regs: std.enums.EnumArray(Register, u16),

    pub inline fn current() X86_16 {
        var ctx: X86_16 = undefined;
        asm volatile (
            \\ movw %%sp, 0x00(%%di)
            \\ movw %%bp, 0x02(%%di)
            \\ movw %%ss, 0x04(%%di)
            \\ pushw %%cs
            \\ call 1f
            \\1:
            \\ popw 0x06(%%di)
            \\ popw 0x08(%%di)
            :
            : [gprs] "{di}" (&ctx.regs.values),
            : .{ .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const X86_16) u16 {
        return ctx.regs.get(.bp);
    }
    pub fn getPc(ctx: *const X86_16) u16 {
        return ctx.regs.get(.ip);
    }

    // NOTE: There doesn't seem to be any standard for DWARF x86-16 so we'll just reuse the ones for x86.
    pub fn dwarfRegisterBytes(ctx: *X86_16, register_num: u16) DwarfRegisterError![]u8 {
        switch (register_num) {
            4 => return @ptrCast(ctx.regs.getPtr(.sp)),
            5 => return @ptrCast(ctx.regs.getPtr(.bp)),
            6 => return @ptrCast(ctx.regs.getPtr(.ip)),
            41 => return @ptrCast(ctx.regs.getPtr(.cs)),
            42 => return @ptrCast(ctx.regs.getPtr(.ss)),
            else => return error.InvalidRegister,
        }
    }
};

const X86 = struct {
    /// The first 8 registers here intentionally match the order of registers in the x86 instruction
    /// encoding. This order is inherited by the PUSHA instruction and the DWARF register mappings,
    /// among other things.
    pub const Gpr = enum {
        // zig fmt: off
        eax, ecx, edx, ebx,
        esp, ebp, esi, edi,
        eip,
        // zig fmt: on
    };
    gprs: std.enums.EnumArray(Gpr, u32),

    pub inline fn current() X86 {
        var ctx: X86 = undefined;
        asm volatile (
            \\ movl %%eax, 0x00(%%edi)
            \\ movl %%ecx, 0x04(%%edi)
            \\ movl %%edx, 0x08(%%edi)
            \\ movl %%ebx, 0x0c(%%edi)
            \\ movl %%esp, 0x10(%%edi)
            \\ movl %%ebp, 0x14(%%edi)
            \\ movl %%esi, 0x18(%%edi)
            \\ movl %%edi, 0x1c(%%edi)
            \\ call 1f
            \\1:
            \\ popl 0x20(%%edi)
            :
            : [gprs] "{edi}" (&ctx.gprs.values),
            : .{ .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const X86) u32 {
        return ctx.gprs.get(.ebp);
    }
    pub fn getPc(ctx: *const X86) u32 {
        return ctx.gprs.get(.eip);
    }

    pub fn dwarfRegisterBytes(ctx: *X86, register_num: u16) DwarfRegisterError![]u8 {
        // System V Application Binary Interface Intel386 Architecture Processor Supplement Version 1.1
        //   § 2.4.2 "DWARF Register Number Mapping"
        switch (register_num) {
            // The order of `Gpr` intentionally matches DWARF's mappings.
            //
            // x86-macos sometimes uses different mappings (ebp and esp are reversed when the unwind
            // information is from `__eh_frame`). This deviation is not considered here, because
            // x86-macos is a deprecated target which is not supported by the Zig Standard Library.
            0...8 => return @ptrCast(&ctx.gprs.values[register_num]),

            9 => return error.UnsupportedRegister, // eflags
            11...18 => return error.UnsupportedRegister, // st0 - st7
            21...28 => return error.UnsupportedRegister, // xmm0 - xmm7
            29...36 => return error.UnsupportedRegister, // mm0 - mm7
            39 => return error.UnsupportedRegister, // mxcsr
            40...45 => return error.UnsupportedRegister, // es, cs, ss, ds, fs, gs
            48 => return error.UnsupportedRegister, // tr
            49 => return error.UnsupportedRegister, // ldtr
            93...100 => return error.UnsupportedRegister, // k0 - k7 (AVX-512)

            else => return error.InvalidRegister,
        }
    }
};

const X86_64 = struct {
    /// The order here intentionally matches the order of the DWARF register mappings. It's unclear
    /// where those mappings actually originated from---the ordering of the first 4 registers seems
    /// quite unusual---but it is currently convenient for us to match DWARF.
    pub const Gpr = enum {
        // zig fmt: off
        rax, rdx, rcx, rbx,
        rsi, rdi, rbp, rsp,
        r8,  r9,  r10, r11,
        r12, r13, r14, r15,
        rip,
        // zig fmt: on
    };
    gprs: std.enums.EnumArray(Gpr, u64),

    pub inline fn current() X86_64 {
        var ctx: X86_64 = undefined;
        asm volatile (
            \\ movq %%rax, 0x00(%%rdi)
            \\ movq %%rdx, 0x08(%%rdi)
            \\ movq %%rcx, 0x10(%%rdi)
            \\ movq %%rbx, 0x18(%%rdi)
            \\ movq %%rsi, 0x20(%%rdi)
            \\ movq %%rdi, 0x28(%%rdi)
            \\ movq %%rbp, 0x30(%%rdi)
            \\ movq %%rsp, 0x38(%%rdi)
            \\ movq %%r8,  0x40(%%rdi)
            \\ movq %%r9,  0x48(%%rdi)
            \\ movq %%r10, 0x50(%%rdi)
            \\ movq %%r11, 0x58(%%rdi)
            \\ movq %%r12, 0x60(%%rdi)
            \\ movq %%r13, 0x68(%%rdi)
            \\ movq %%r14, 0x70(%%rdi)
            \\ movq %%r15, 0x78(%%rdi)
            \\ leaq (%%rip), %%rax
            \\ movq %%rax, 0x80(%%rdi)
            :
            : [gprs] "{rdi}" (&ctx.gprs.values),
            : .{ .rax = true, .memory = true });
        return ctx;
    }

    pub fn getFp(ctx: *const X86_64) usize {
        // On x32, registers are 64 bits but `usize` is 32 bits.
        return @intCast(ctx.gprs.get(.rbp));
    }
    pub fn getPc(ctx: *const X86_64) usize {
        // On x32, registers are 64 bits but `usize` is 32 bits.
        return @intCast(ctx.gprs.get(.rip));
    }

    pub fn dwarfRegisterBytes(ctx: *X86_64, register_num: u16) DwarfRegisterError![]u8 {
        // System V Application Binary Interface AMD64 Architecture Processor Supplement
        //   § 3.6.2 "DWARF Register Number Mapping"
        switch (register_num) {
            // The order of `Gpr` intentionally matches DWARF's mappings.
            0...16 => return @ptrCast(&ctx.gprs.values[register_num]),

            17...32 => return error.UnsupportedRegister, // xmm0 - xmm15
            33...40 => return error.UnsupportedRegister, // st0 - st7
            41...48 => return error.UnsupportedRegister, // mm0 - mm7
            49 => return error.UnsupportedRegister, // rflags
            50...55 => return error.UnsupportedRegister, // es, cs, ss, ds, fs, gs
            58...59 => return error.UnsupportedRegister, // fs.base, gs.base
            62 => return error.UnsupportedRegister, // tr
            63 => return error.UnsupportedRegister, // ldtr
            64 => return error.UnsupportedRegister, // mxcsr
            65 => return error.UnsupportedRegister, // fcw
            66 => return error.UnsupportedRegister, // fsw
            67...82 => return error.UnsupportedRegister, // xmm16 - xmm31 (AVX-512)
            118...125 => return error.UnsupportedRegister, // k0 - k7 (AVX-512)
            130...145 => return error.UnsupportedRegister, // r16 - r31 (APX)

            else => return error.InvalidRegister,
        }
    }
};

/// The native operating system's `ucontext_t` as seen in the third argument to signal handlers.
///
/// These are dramatically simplified since we only need general-purpose registers and don't care
/// about all the complicated extension state (floating point, vector, etc). This means that these
/// structures are almost all shorter than the real ones, which is safe because we only access them
/// through a pointer.
///
/// Some effort is made to have structures for the same architecture use the same access pattern,
/// e.g. `uc.mcontext.x` for `aarch64-linux` and `aarch64-freebsd` even though that's not quite how
/// they're declared and spelled in the C headers for both targets. Similarly, registers are typed
/// as unsigned everywhere even if that's not how they're declared in the C headers.
const signal_ucontext_t = switch (native_os) {
    .linux => switch (native_arch) {
        // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/alpha/include/asm/ucontext.h
        .alpha => extern struct {
            _flags: u64,
            _link: ?*signal_ucontext_t,
            _osf_sigmask: u64,
            _stack: std.os.linux.stack_t,
            // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/alpha/include/uapi/asm/sigcontext.h
            mcontext: extern struct {
                _onstack: i64,
                _mask: i64,
                pc: u64,
                _ps: i64,
                r: [32]u64,
            },
        },
        // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/arm64/include/uapi/asm/ucontext.h
        .aarch64,
        .aarch64_be,
        // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/loongarch/include/uapi/asm/ucontext.h
        .loongarch64,
        // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/powerpc/include/uapi/asm/ucontext.h
        .powerpc64,
        .powerpc64le,
        // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/riscv/include/uapi/asm/ucontext.h
        .riscv32,
        .riscv64,
        => extern struct {
            _flags: usize,
            _link: ?*signal_ucontext_t,
            _stack: std.os.linux.stack_t,
            _sigmask: std.os.linux.sigset_t,
            _unused: [120]u8,
            mcontext: switch (native_arch) {
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/arm64/include/uapi/asm/sigcontext.h
                .aarch64, .aarch64_be => extern struct {
                    _fault_address: u64 align(16),
                    x: [30]u64,
                    lr: u64,
                    sp: u64,
                    pc: u64,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/loongarch/include/uapi/asm/sigcontext.h
                .loongarch64 => extern struct {
                    pc: u64 align(16),
                    r: [32]u64,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/powerpc/include/uapi/asm/sigcontext.h
                .powerpc64, .powerpc64le => extern struct {
                    _unused: [4]u64,
                    _signal: i32,
                    _pad: i32,
                    _handler: u64,
                    _oldmask: u64,
                    _regs: ?*anyopaque,
                    r: [32]u64,
                    pc: u64,
                    _msr: u64,
                    _orig_r3: u64,
                    _ctr: u64,
                    lr: u64,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/riscv/include/uapi/asm/sigcontext.h
                .riscv32, .riscv64 => extern struct {
                    pc: usize align(16),
                    ra_sp_gp_tp: [4]usize,
                    t0_2: [3]usize,
                    s0_1: [2]usize,
                    a: [8]usize,
                    s2_11: [10]usize,
                    t3_6: [4]usize,
                },
                else => unreachable,
            },
        },
        // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/include/uapi/asm-generic/ucontext.h
        .arc,
        .arceb,
        .arm,
        .armeb,
        .thumb,
        .thumbeb,
        .csky,
        .hexagon,
        .m68k,
        .mips,
        .mipsel,
        .mips64,
        .mips64el,
        .or1k,
        .s390x,
        .x86,
        .x86_64,
        .xtensa,
        .xtensaeb,
        => extern struct {
            _flags: usize,
            _link: ?*signal_ucontext_t,
            _stack: std.os.linux.stack_t,
            mcontext: switch (native_arch) {
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/arc/include/uapi/asm/sigcontext.h
                .arc, .arceb => extern struct {
                    _pad1: u32,
                    _bta: u32,
                    _lp: extern struct {
                        _start: u32,
                        _end: u32,
                        _count: u32,
                    },
                    _status32: u32,
                    pcl: u32,
                    r31: u32,
                    r27_26: [2]u32,
                    r12_0: [13]u32,
                    r28: u32,
                    _pad2: u32,
                    r25_13: [13]u32,
                    _efa: u32,
                    _stop_pc: u32,
                    r30: u32,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/arm/include/uapi/asm/sigcontext.h
                .arm, .armeb, .thumb, .thumbeb => extern struct {
                    _trap_no: u32,
                    _error_code: u32,
                    _oldmask: u32,
                    r: [15]u32,
                    pc: u32,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/csky/include/uapi/asm/sigcontext.h
                .csky => extern struct {
                    r31: u32,
                    r15: u32,
                    pc: u32,
                    _sr: u32,
                    r14: u32,
                    _orig_a0: u32,
                    r0_13: [14]u32,
                    r16_30: [15]u32,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/hexagon/include/uapi/asm/sigcontext.h
                .hexagon => extern struct {
                    r: [32]u32 align(8),
                    _salc: [2]extern struct {
                        _sa: u32,
                        _lc: u32,
                    },
                    _m: [2]u32,
                    _usr: u32,
                    _p: u32,
                    _gp: u32,
                    _ugp: u32,
                    pc: u32,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/parisc/include/uapi/asm/sigcontext.h
                .hppa => extern struct {
                    _flags: u32,
                    _psw: u32,
                    r1_19: [19]u32,
                    r20: u32,
                    r21: u32,
                    r22: u32,
                    r23_29: [7]u32,
                    r30: u32,
                    r31: u32,
                    _fr: [32]f64,
                    _iasq: [2]u32,
                    iaoq: [2]u32,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/m68k/include/asm/ucontext.h
                .m68k => extern struct {
                    _version: i32,
                    d: [8]u32,
                    a: [8]u32,
                    pc: u32,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/microblaze/include/uapi/asm/sigcontext.h
                .microblaze, .microblazeel => extern struct {
                    r: [32]u32,
                    pc: u32,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/mips/include/uapi/asm/sigcontext.h
                .mips, .mipsel => extern struct {
                    _regmask: u32,
                    _status: u32,
                    // ??? A spectacularly failed attempt to be future-proof?
                    pc: u64,
                    r: [32]u64,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/mips/include/uapi/asm/sigcontext.h
                .mips64, .mips64el => extern struct {
                    r: [32]u64,
                    _fpregs: [32]u64,
                    _hi: [4]u64,
                    _lo: [4]u64,
                    pc: u64,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/openrisc/include/uapi/asm/sigcontext.h
                .or1k => extern struct {
                    r: [32]u32,
                    pc: u32,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/s390/include/uapi/asm/sigcontext.h
                .s390x => extern struct {
                    psw: extern struct {
                        mask: u64,
                        addr: u64,
                    },
                    r: [16]u64,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/sh/include/uapi/asm/sigcontext.h
                .sh, .sheb => extern struct {
                    _oldmask: u32,
                    r: [16]u32,
                    pc: u32,
                    pr: u32,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/x86/include/uapi/asm/sigcontext.h
                .x86 => extern struct {
                    _gs: u32,
                    _fs: u32,
                    _es: u32,
                    _ds: u32,
                    edi: u32,
                    esi: u32,
                    ebp: u32,
                    esp: u32,
                    ebx: u32,
                    edx: u32,
                    ecx: u32,
                    eax: u32,
                    _trapno: u32,
                    _err: u32,
                    eip: u32,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/x86/include/uapi/asm/sigcontext.h
                .x86_64 => extern struct {
                    r8: u64,
                    r9: u64,
                    r10: u64,
                    r11: u64,
                    r12: u64,
                    r13: u64,
                    r14: u64,
                    r15: u64,
                    rdi: u64,
                    rsi: u64,
                    rbp: u64,
                    rbx: u64,
                    rdx: u64,
                    rax: u64,
                    rcx: u64,
                    rsp: u64,
                    rip: u64,
                },
                // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/xtensa/include/uapi/asm/sigcontext.h
                .xtensa, .xtensaeb => extern struct {
                    pc: u32,
                    _ps: u32,
                    _l: extern struct {
                        _beg: u32,
                        _end: u32,
                        _count: u32,
                    },
                    _sar: u32,
                    _acc: extern struct {
                        _lo: u32,
                        _hi: u32,
                    },
                    a: [16]u32,
                },
                else => unreachable,
            },
        },
        // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/powerpc/include/uapi/asm/ucontext.h
        .powerpc, .powerpcle => extern struct {
            _flags: u32,
            _link: ?*signal_ucontext_t,
            _stack: std.os.linux.stack_t,
            _pad1: [7]i32,
            _regs: ?*anyopaque,
            _sigmask: std.os.linux.sigset_t,
            _unused: [120]u8,
            _pad2: [3]i32,
            mcontext: extern struct {
                r: [32]u32 align(16),
                pc: u32,
                _msr: u32,
                _orig_r3: u32,
                _ctr: u32,
                lr: u32,
            },
        },
        // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/sparc/kernel/signal_32.c#L48-L49
        .sparc => extern struct {
            // Not actually a `ucontext_t` at all because, uh, reasons?

            _info: std.os.linux.siginfo_t,
            mcontext: extern struct {
                _psr: u32,
                pc: u32,
                _npc: u32,
                _y: u32,
                g: [8]u32,
                o: [8]u32,
            },
        },
        // https://github.com/torvalds/linux/blob/cd5a0afbdf8033dc83786315d63f8b325bdba2fd/arch/sparc/kernel/signal_64.c#L247-L248
        .sparc64 => extern struct {
            // Ditto...

            _info: std.os.linux.siginfo_t,
            mcontext: extern struct {
                g: [8]u64,
                o: [8]u64,
                _tstate: u64,
                pc: u64,
            },
        },
        else => unreachable,
    },
    // https://github.com/freebsd/freebsd-src/blob/55c28005f544282b984ae0e15dacd0c108d8ab12/sys/sys/_ucontext.h
    .freebsd => extern struct {
        _sigmask: std.c.sigset_t,
        mcontext: switch (native_arch) {
            // https://github.com/freebsd/freebsd-src/blob/55c28005f544282b984ae0e15dacd0c108d8ab12/sys/arm64/include/ucontext.h
            .aarch64 => extern struct {
                x: [30]u64 align(16),
                lr: u64,
                sp: u64,
                pc: u64,
            },
            // https://github.com/freebsd/freebsd-src/blob/55c28005f544282b984ae0e15dacd0c108d8ab12/sys/arm/include/ucontext.h
            .arm => extern struct {
                r: [15]u32,
                pc: u32,
            },
            // https://github.com/freebsd/freebsd-src/blob/55c28005f544282b984ae0e15dacd0c108d8ab12/sys/powerpc/include/ucontext.h
            .powerpc64, .powerpc64le => extern struct {
                _vers: i32 align(16),
                _flags: i32,
                _onstack: i32,
                _len: i32,
                _avec: [32 * 2]u64,
                _av: [2]u32,
                r: [32]u64,
                lr: u64,
                _cr: u64,
                _xer: u64,
                _ctr: u64,
                pc: u64,
            },
            // https://github.com/freebsd/freebsd-src/blob/55c28005f544282b984ae0e15dacd0c108d8ab12/sys/riscv/include/ucontext.h
            .riscv64 => extern struct {
                ra_sp_gp_tp: [4]u64,
                t0_2: [3]u64,
                t3_6: [4]u64,
                s0_1: [2]u64,
                s2_11: [10]u64,
                a: [8]u64,
                pc: u64,
            },
            // https://github.com/freebsd/freebsd-src/blob/55c28005f544282b984ae0e15dacd0c108d8ab12/sys/x86/include/ucontext.h
            .x86_64 => extern struct {
                _onstack: i64,
                rdi: u64,
                rsi: u64,
                rdx: u64,
                rcx: u64,
                r8: u64,
                r9: u64,
                rax: u64,
                rbx: u64,
                rbp: u64,
                r10: u64,
                r11: u64,
                r12: u64,
                r13: u64,
                r14: u64,
                r15: u64,
                _trapno: i32,
                _fs: i16,
                _gs: i16,
                _addr: i64,
                _flags: i32,
                _es: i16,
                _ds: i16,
                _err: i64,
                rip: u64,
                _cs: i64,
                _rflags: i64,
                rsp: u64,
            },
            else => unreachable,
        },
    },
    // https://github.com/ziglang/zig/blob/60be67d3c0ba6ae15fa7115596734ab1e74fbcd3/lib/libc/include/any-macos-any/sys/_types/_ucontext.h
    .driverkit, .ios, .maccatalyst, .macos, .tvos, .watchos, .visionos => extern struct {
        _onstack: i32,
        _sigmask: std.c.sigset_t,
        _stack: std.c.stack_t,
        _link: ?*signal_ucontext_t,
        _mcsize: u64,
        mcontext: *switch (native_arch) {
            // https://github.com/ziglang/zig/blob/60be67d3c0ba6ae15fa7115596734ab1e74fbcd3/lib/libc/include/any-macos-any/arm/_mcontext.h
            // https://github.com/ziglang/zig/blob/60be67d3c0ba6ae15fa7115596734ab1e74fbcd3/lib/libc/include/any-macos-any/mach/arm/_structs.h
            .aarch64 => extern struct {
                _far: u64 align(16),
                _esr: u64,
                x: [30]u64,
                lr: u64,
                sp: u64,
                pc: u64,
            },
            // https://github.com/ziglang/zig/blob/60be67d3c0ba6ae15fa7115596734ab1e74fbcd3/lib/libc/include/any-macos-any/i386/_mcontext.h
            // https://github.com/ziglang/zig/blob/60be67d3c0ba6ae15fa7115596734ab1e74fbcd3/lib/libc/include/any-macos-any/mach/i386/_structs.h
            .x86_64 => extern struct {
                _trapno: u16,
                _cpu: u16,
                _err: u32,
                _faultvaddr: u64,
                rax: u64,
                rbx: u64,
                rcx: u64,
                rdx: u64,
                rdi: u64,
                rsi: u64,
                rbp: u64,
                rsp: u64,
                r8: u64,
                r9: u64,
                r10: u64,
                r11: u64,
                r12: u64,
                r13: u64,
                r14: u64,
                r15: u64,
                rip: u64,
            },
            else => unreachable,
        },
    },
    // https://github.com/illumos/illumos-gate/blob/d4ce137bba3bd16823db6374d9e9a643264ce245/usr/src/uts/intel/sys/ucontext.h
    .illumos => extern struct {
        _flags: usize,
        _link: ?*signal_ucontext_t,
        _sigmask: std.c.sigset_t,
        _stack: std.c.stack_t,
        mcontext: switch (native_arch) {
            // https://github.com/illumos/illumos-gate/blob/d4ce137bba3bd16823db6374d9e9a643264ce245/usr/src/uts/intel/sys/mcontext.h
            .x86 => extern struct {
                _gs: u32,
                _fs: u32,
                _es: u32,
                _ds: u32,
                edi: u32,
                esi: u32,
                ebp: u32,
                esp: u32,
                ebx: u32,
                edx: u32,
                ecx: u32,
                eax: u32,
                _trapno: i32,
                _err: i32,
                eip: u32,
            },
            // https://github.com/illumos/illumos-gate/blob/d4ce137bba3bd16823db6374d9e9a643264ce245/usr/src/uts/intel/sys/mcontext.h
            .x86_64 => extern struct {
                r15: u64 align(16),
                r14: u64,
                r13: u64,
                r12: u64,
                r11: u64,
                r10: u64,
                r9: u64,
                r8: u64,
                rdi: u64,
                rsi: u64,
                rbp: u64,
                rbx: u64,
                rdx: u64,
                rcx: u64,
                rax: u64,
                _trapno: i64,
                _err: i64,
                rip: u64,
                _cs: i64,
                _rflags: i64,
                rsp: u64,
            },
            else => unreachable,
        },
    },
    .openbsd => switch (native_arch) {
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/arm64/include/signal.h
        .aarch64 => extern struct {
            _unused: i32,
            _mask: i32,
            mcontext: extern struct {
                sp: u64,
                lr: u64,
                pc: u64,
                _spsr: u64,
                x: [30]u64,
            },
        },
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/alpha/include/signal.h
        .alpha => extern struct {
            _cookie: i64,
            _mask: i64,
            pc: u64,
            _ps: i64,
            r: [32]u64,
        },
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/arm/include/signal.h
        .arm => extern struct {
            _cookie: i32,
            _mask: i32,
            mcontext: extern struct {
                _spsr: u32 align(8),
                r: [15]u32,
                _svc_lr: u32,
                pc: u32,
            },
        },
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/hppa/include/signal.h
        .hppa => extern struct {
            _unused: u32,
            _mask: i32,
            _fp: u32,
            iaoq: [2]u32,
            _resv: [2]u32,
            r22: u32,
            r21: u32,
            r30: u32,
            r20: u32,
            _sar: u32,
            r1_19: [19]u32,
            r23_29: [7]u32,
            r31: u32,
        },
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/mips64/include/signal.h
        .mips64, .mips64el => extern struct {
            _cookie: i64,
            _mask: i64,
            mcontext: extern struct {
                pc: u64,
                r: [32]u64,
            },
        },
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/powerpc/include/signal.h
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/powerpc64/include/signal.h
        .powerpc, .powerpc64 => extern struct {
            _cookie: isize,
            _mask: i32,
            mcontext: extern struct {
                r: [32]usize,
                lr: usize,
                _cr: usize,
                _xer: usize,
                _ctr: usize,
                pc: usize,
            },
        },
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/riscv64/include/signal.h
        .riscv64 => extern struct {
            _unused: i32,
            _mask: i32,
            mcontext: extern struct {
                ra_sp_gp_tp: [4]u64,
                t0_2: [3]u64,
                t3_6: [4]u64,
                s0_1: [2]u64,
                s2_11: [10]u64,
                a: [8]u64,
                pc: u64,
            },
        },
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/sparc64/include/signal.h
        .sparc64 => @compileError("sparc64-openbsd ucontext_t missing"),
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/sh/include/signal.h
        .sh, .sheb => extern struct {
            pc: u32,
            _sr: i32,
            _gbr: i32,
            _macl: i32,
            _mach: i32,
            pr: u32,
            r13_0: [14]u32,
            r15: u32,
            r14: u32,
        },
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/i386/include/signal.h
        .x86 => extern struct {
            mcontext: extern struct {
                _gs: i32,
                _fs: i32,
                _es: i32,
                _ds: i32,
                edi: u32,
                esi: u32,
                ebp: u32,
                ebx: u32,
                edx: u32,
                ecx: u32,
                eax: u32,
                eip: u32,
                _cs: i32,
                _eflags: i32,
                esp: u32,
            },
        },
        // https://github.com/openbsd/src/blob/42468faed8369d07ae49ae02dd71ec34f59b66cd/sys/arch/amd64/include/signal.h
        .x86_64 => extern struct {
            mcontext: extern struct {
                rdi: u64,
                rsi: u64,
                rdx: u64,
                rcx: u64,
                r8: u64,
                r9: u64,
                r10: u64,
                r11: u64,
                r12: u64,
                r13: u64,
                r14: u64,
                r15: u64,
                rbp: u64,
                rbx: u64,
                rax: u64,
                _gs: i64,
                _fs: i64,
                _es: i64,
                _ds: i64,
                _trapno: i64,
                _err: i64,
                rip: u64,
                _cs: i64,
                _rflags: i64,
                rsp: u64,
            },
        },
        else => unreachable,
    },
    // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/sys/ucontext.h
    .netbsd => extern struct {
        _flags: u32,
        _link: ?*signal_ucontext_t,
        _sigmask: std.c.sigset_t,
        _stack: std.c.stack_t,
        mcontext: switch (native_arch) {
            // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/arch/arm/include/mcontext.h
            .aarch64, .aarch64_be => extern struct {
                x: [30]u64 align(16),
                lr: u64,
                sp: u64,
                pc: u64,
            },
            // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/arch/alpha/include/mcontext.h
            .alpha => extern struct {
                r: [32]u64,
                pc: u64,
            },
            // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/arch/arm/include/mcontext.h
            .arm, .armeb => extern struct {
                r: [15]u32 align(8),
                pc: u32,
            },
            // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/arch/m68k/include/mcontext.h
            .m68k => extern struct {
                d: [8]u32,
                a: [8]u32,
                pc: u32,
            },
            // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/arch/mips/include/mcontext.h
            .mips, .mipsel => extern struct {
                r: [32]u32 align(8),
                _lo: i32,
                _hi: i32,
                _cause: i32,
                pc: u32,
            },
            // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/arch/mips/include/mcontext.h
            .mips64, .mips64el => @compileError("https://github.com/ziglang/zig/issues/23765#issuecomment-2880386178"),
            // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/arch/powerpc/include/mcontext.h
            .powerpc => extern struct {
                r: [32]u32 align(16),
                _cr: i32,
                lr: u32,
                pc: u32,
            },
            // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/arch/sparc/include/mcontext.h
            .sparc => @compileError("sparc-netbsd mcontext_t missing"),
            .sparc64 => @compileError("sparc64-netbsd mcontext_t missing"),
            // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/arch/sh3/include/mcontext.h
            .sh, .sheb => extern struct {
                _gbr: i32,
                pc: u32,
                _sr: i32,
                _macl: i32,
                _mach: i32,
                pr: u32,
                r14: u32,
                r13_0: [14]u32,
                r15: u32,
            },
            // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/arch/i386/include/mcontext.h
            .x86 => extern struct {
                _gs: i32,
                _fs: i32,
                _es: i32,
                _ds: i32,
                edi: u32,
                esi: u32,
                ebp: u32,
                esp: u32,
                ebx: u32,
                edx: u32,
                ecx: u32,
                eax: u32,
                _trapno: i32,
                _err: i32,
                eip: u32,
            },
            // https://github.com/NetBSD/src/blob/861008c62187bf7bc0aac4d81e52ed6eee4d0c74/sys/arch/amd64/include/mcontext.h
            .x86_64 => extern struct {
                rdi: u64,
                rsi: u64,
                rdx: u64,
                rcx: u64,
                r8: u64,
                r9: u64,
                r10: u64,
                r11: u64,
                r12: u64,
                r13: u64,
                r14: u64,
                r15: u64,
                rbp: u64,
                rbx: u64,
                rax: u64,
                _gs: i64,
                _fs: i64,
                _es: i64,
                _ds: i64,
                _trapno: i64,
                _err: i64,
                rip: u64,
                _cs: i64,
                _rflags: i64,
                rsp: u64,
            },
            else => unreachable,
        },
    },
    // https://github.com/DragonFlyBSD/DragonFlyBSD/blob/3de1e9d36269616d22237f19d60a737a41271ab5/sys/sys/_ucontext.h
    .dragonfly => extern struct {
        _sigmask: std.c.sigset_t,
        mcontext: switch (native_arch) {
            // https://github.com/DragonFlyBSD/DragonFlyBSD/blob/3de1e9d36269616d22237f19d60a737a41271ab5/sys/cpu/x86_64/include/ucontext.h
            .x86_64 => extern struct {
                _onstack: i64 align(64),
                rdi: u64,
                rsi: u64,
                rdx: u64,
                rcx: u64,
                r8: u64,
                r9: u64,
                rax: u64,
                rbx: u64,
                rbp: u64,
                r10: u64,
                r11: u64,
                r12: u64,
                r13: u64,
                r14: u64,
                r15: u64,
                _xflags: i64,
                _trapno: i64,
                _addr: i64,
                _flags: i64,
                _err: i64,
                rip: u64,
                _cs: i64,
                _rflags: i64,
                rsp: u64,
            },
            else => unreachable,
        },
    },
    // https://github.com/SerenityOS/serenity/blob/103d6a07de9e28f3c94dfa2351b9af76a49ba6e6/Kernel/API/POSIX/ucontext.h
    .serenity => extern struct {
        _link: ?*signal_ucontext_t,
        _sigmask: std.c.sigset_t,
        _stack: std.c.stack_t,
        mcontext: switch (native_arch) {
            // https://github.com/SerenityOS/serenity/blob/103d6a07de9e28f3c94dfa2351b9af76a49ba6e6/Kernel/Arch/aarch64/mcontext.h
            .aarch64 => extern struct {
                x: [30]u64,
                lr: u64,
                sp: u64,
                pc: u64,
            },
            // https://github.com/SerenityOS/serenity/blob/103d6a07de9e28f3c94dfa2351b9af76a49ba6e6/Kernel/Arch/riscv64/mcontext.h
            .riscv64 => extern struct {
                ra_sp_gp_tp: [4]u64,
                t0_2: [3]u64,
                s0_1: [2]u64,
                a: [8]u64,
                s2_11: [10]u64,
                t3_6: [4]u64,
                pc: u64,
            },
            // https://github.com/SerenityOS/serenity/blob/103d6a07de9e28f3c94dfa2351b9af76a49ba6e6/Kernel/Arch/x86_64/mcontext.h
            .x86_64 => extern struct {
                rax: u64,
                rcx: u64,
                rdx: u64,
                rbx: u64,
                rsp: u64,
                rbp: u64,
                rsi: u64,
                rdi: u64,
                rip: u64,
                r8: u64,
                r9: u64,
                r10: u64,
                r11: u64,
                r12: u64,
                r13: u64,
                r14: u64,
                r15: u64,
            },
            else => unreachable,
        },
    },
    // https://github.com/haiku/haiku/blob/47538c534fe0aadc626c09d121773fee8ea10d71/headers/posix/signal.h#L356
    .haiku => extern struct {
        _link: ?*signal_ucontext_t,
        _sigmask: std.c.sigset_t,
        _stack: std.c.stack_t,
        mcontext: switch (native_arch) {
            // https://github.com/haiku/haiku/blob/47538c534fe0aadc626c09d121773fee8ea10d71/headers/posix/arch/arm/signal.h
            .arm => extern struct {
                r: [15]u32 align(8),
                pc: u32,
            },
            // https://github.com/haiku/haiku/blob/47538c534fe0aadc626c09d121773fee8ea10d71/headers/posix/arch/arm64/signal.h
            .aarch64 => extern struct {
                x: [30]u64 align(16),
                lr: u64,
                sp: u64,
                pc: u64,
            },
            // https://github.com/haiku/haiku/blob/47538c534fe0aadc626c09d121773fee8ea10d71/headers/posix/arch/m68k/signal.h
            .m68k => extern struct {
                pc: u32 align(8),
                d: [8]u32,
                a: [8]u32,
            },
            // https://github.com/haiku/haiku/blob/47538c534fe0aadc626c09d121773fee8ea10d71/headers/posix/arch/ppc/signal.h
            .powerpc => extern struct {
                pc: u32 align(8),
                r: [13]u32, // Um, are you okay, Haiku?
                _f: [14]f64,
                _reserved: u32,
                _fpscr: u32,
                _ctr: u32,
                _xer: u32,
                _cr: u32,
                _msr: u32,
                lr: u32,
            },
            // https://github.com/haiku/haiku/blob/47538c534fe0aadc626c09d121773fee8ea10d71/headers/posix/arch/riscv64/signal.h
            .riscv64 => extern struct {
                ra_sp_gp_tp: [4]u64,
                t0_2: [3]u64,
                s0_1: [2]u64,
                a: [8]u64,
                s2_11: [10]u64,
                t3_6: [4]u64,
                pc: u64,
            },
            // https://github.com/haiku/haiku/blob/47538c534fe0aadc626c09d121773fee8ea10d71/headers/posix/arch/sparc64/signal.h
            .sparc64 => @compileError("sparc64-haiku mcontext_t missing"),
            // https://github.com/haiku/haiku/blob/47538c534fe0aadc626c09d121773fee8ea10d71/headers/posix/arch/x86/signal.h
            .x86 => extern struct {
                eip: u32,
                _eflags: u32,
                eax: u32,
                ecx: u32,
                edx: u32,
                esp: u32,
                ebp: u32,
                _reserved: u32,
                _xregs: extern struct {
                    _fp_control: u16,
                    _fp_status: u16,
                    _fp_tag: u16,
                    _fp_opcode: u16,
                    _fp_eip: u32,
                    _fp_cs: u16,
                    _reserved1: u16,
                    _fp_datap: u32,
                    _fp_ds: u16,
                    _reserved2: u16,
                    _mxcsr: u32,
                    _mxcsr_mask: u32,
                    _mmx: [8][16]u8,
                    _xmmx: [8][16]u8,
                    _reserved3: [176]u8,
                    _fault_address: u32,
                    _error_code: u32,
                    _cs: u16,
                    _ds: u16,
                    _es: u16,
                    _fs: u16,
                    _gs: u16,
                    _ss: u16,
                    _trap_number: u8,
                    _reserved4: [27]u8,
                    _format: u32,
                },
                edi: u32,
                esi: u32,
                ebx: u32,
            },
            // https://github.com/haiku/haiku/blob/47538c534fe0aadc626c09d121773fee8ea10d71/headers/posix/arch/x86_64/signal.h
            .x86_64 => extern struct {
                rax: u64,
                rbx: u64,
                rcx: u64,
                rdx: u64,
                rdi: u64,
                rsi: u64,
                rbp: u64,
                r8: u64,
                r9: u64,
                r10: u64,
                r11: u64,
                r12: u64,
                r13: u64,
                r14: u64,
                r15: u64,
                rsp: u64,
                rip: u64,
            },
            else => unreachable,
        },
    },
    else => void,
};

const std = @import("std");
const root = @import("root");
const builtin = @import("builtin");
const native_arch = @import("builtin").target.cpu.arch;
const native_os = @import("builtin").target.os.tag;
