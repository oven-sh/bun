//! Static ISA verifier for Bun baseline builds.
//!
//! Disassembles every executable section of a binary and flags any instruction
//! that requires a CPU feature beyond the baseline target (x64 Nehalem for now).
//! Violations are attributed to the containing symbol and checked against an
//! explicit allowlist of symbols known to be runtime-dispatched behind a CPUID
//! gate.
//!
//! This complements the emulator-based check in scripts/verify-baseline.ts,
//! which only catches instructions the test suite actually executes.
//!
//! Exit codes: 0 = clean, 1 = violations outside allowlist, 2 = tool error.

mod aarch64;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use iced_x86::{Code, CpuidFeature, Decoder, DecoderOptions, Instruction, Mnemonic};
use object::{Object, ObjectSection, ObjectSymbol, SectionKind, SymbolKind, SymbolSection};

/// Nehalem's exact feature set per iced-x86's CpuidFeature taxonomy.
///
/// Nehalem (Core i7, 2008) is the last Intel microarch before AVX. Bun's
/// baseline build targets it via `-march=nehalem` (cmake/CompilerFlags.cmake:33)
/// and `std.Target.x86.cpu.nehalem` (build.zig).
///
/// Notably ABSENT: AES-NI and PCLMULQDQ are Westmere (2010), not Nehalem.
/// This trips people up because they're legacy-encoded (no VEX prefix) and
/// thus look "old", but a real Nehalem chip will SIGILL on aesenc.
const NEHALEM_ALLOWED: &[CpuidFeature] = &[
    // Base x86 lineage — iced tags ancient instructions with these.
    CpuidFeature::INTEL8086,
    CpuidFeature::INTEL186,
    CpuidFeature::INTEL286,
    CpuidFeature::INTEL386,
    CpuidFeature::INTEL486,
    CpuidFeature::X64,
    CpuidFeature::CPUID,
    // FPU / x87.
    CpuidFeature::FPU,
    CpuidFeature::FPU287,
    CpuidFeature::FPU387,
    CpuidFeature::CMOV, // also covers FCMOVcc
    // Classic integer/system.
    CpuidFeature::TSC,
    CpuidFeature::MSR,
    CpuidFeature::CX8,   // CMPXCHG8B
    CpuidFeature::SEP,   // SYSENTER/SYSEXIT
    CpuidFeature::CLFSH, // CLFLUSH
    CpuidFeature::FXSR,  // FXSAVE/FXRSTOR
    CpuidFeature::SYSCALL,
    CpuidFeature::RDTSCP, // Nehalem has this (K8 introduced it, Intel added in Nehalem)
    // LAHF/SAHF in 64-bit: iced doesn't tag these with a distinct feature
    // (they're just INTEL8086 or X64). If it ever does, we'd add it here.
    CpuidFeature::CMPXCHG16B, // Nehalem has it, required by x86-64-v2
    // SIMD lineage up to and including SSE4.2.
    CpuidFeature::MMX,
    CpuidFeature::SSE,
    CpuidFeature::SSE2,
    CpuidFeature::SSE3,
    CpuidFeature::MONITOR, // MONITOR/MWAIT, introduced with SSE3
    CpuidFeature::SSSE3,
    CpuidFeature::SSE4_1,
    CpuidFeature::SSE4_2,
    CpuidFeature::POPCNT,
    // PAUSE is architecturally a hinted NOP since P4; iced tags it separately.
    // PREFETCHW was AMD-only for ages but Intel added it by Nehalem era (it's
    // a NOP if the line isn't in a modifiable state anyway — safe).
    CpuidFeature::PAUSE,
    CpuidFeature::PREFETCHW,
    // Privileged/VMX. These won't execute in userspace anyway, but they're
    // decodable on Nehalem so don't flag them (some show up as data-in-text
    // false positives that happen to decode).
    CpuidFeature::VMX,
    CpuidFeature::SMX,
    // Multi-byte NOP. Architectural since P6, iced tags it separately.
    CpuidFeature::MULTIBYTENOP,
    // CET IBT (ENDBR64/ENDBR32) was designed for backward compat: the
    // indirect-branch-tracking insns occupy the multi-byte-NOP encoding
    // space (f3 0f 1e xx) and execute as NOPs on pre-CET CPUs. Compilers
    // emit ENDBR64 at every function entry when -fcf-protection is on
    // (glibc's crt*.o is built this way). Harmless on Nehalem.
    //
    // CET_SS is NOT in this list: WRSSD/WRSSQ/RSTORSSP/SETSSBSY etc. use
    // dedicated opcode slots that #UD on pre-CET hardware. No compiler
    // emits them without explicit shadow-stack enablement, but they're
    // not NOP-safe.
    CpuidFeature::CET_IBT,
];

/// Instructions that iced classifies as post-Nehalem but are actually safe
/// on Nehalem hardware. Not the same as NEHALEM_ALLOWED: that's about CPUID
/// feature bits, this is about specific instructions whose encoding falls
/// back gracefully.
fn is_harmless_on_nehalem(insn: &Instruction) -> bool {
    // TZCNT encodes as REP BSF. On pre-BMI1 CPUs the REP prefix is ignored
    // and it executes as plain BSF. For nonzero inputs TZCNT(x)==BSF(x);
    // the only difference is input==0 (BSF leaves dest undefined/preserved,
    // TZCNT writes the operand width).
    //
    // LLVM targeting -march=nehalem emits TZCNT anyway, but always with a
    // preload of the operand width into the destination register first:
    //
    //     movl  $32, %eax      ; preload with width
    //     tzcnt %edi, %eax     ; on Nehalem: bsf; if src==0, dest stays 32
    //
    // Result is identical on both BMI1 and pre-BMI1 hardware. Observed on
    // a real linux-x64-baseline build: 4075 symbols use this pattern, all
    // compiler-emitted. Hand-written asm that uses TZCNT without preloading
    // would be a real bug, but none exists in the current dependency set.
    //
    // LZCNT is NOT whitelisted: it encodes as REP BSR, and LZCNT(x) !=
    // BSR(x) for nonzero x (one counts leading zeros, the other returns
    // highest-set-bit index). LLVM never emits LZCNT for @clz on
    // -march=nehalem — it uses BSR+XOR instead — so if LZCNT appears it's
    // a leak to flag.
    if insn.mnemonic() == Mnemonic::Tzcnt {
        return true;
    }

    // XGETBV reads XCR0, which is the only way to check whether the OS has
    // enabled AVX state (CPUID says the CPU *can* do AVX; XCR0 says the OS
    // *lets you*). Every correct AVX-dispatch path must call XGETBV, but
    // XGETBV itself requires XSAVE (post-Nehalem). Correct code gates it:
    //
    //     if (cpuid.OSXSAVE) { xcr0 = xgetbv(0); ... }
    //
    // Every AVX feature-detection path (compiler-rt's __cpu_indicator_init,
    // Rust's core::arch::x86::__xgetbv, any library that dispatches to AVX)
    // follows this pattern. Rather than allowlist each detector by name, we
    // whitelist the instruction itself. A stray XGETBV outside a CPUID gate
    // would SIGILL on Nehalem immediately at startup — the emulator test
    // catches that case trivially.
    if insn.code() == Code::Xgetbv {
        return true;
    }

    // RDSSP/INCSSP encode in hint/NOP space (f3 0f 1e /1 and f3 0f ae /5) and
    // execute as multi-byte NOPs on pre-CET CPUs. MSVC's __longjmp_internal
    // unconditionally calls rdsspq to probe whether shadow-stack is active:
    // on a CET CPU it reads SSP, on Nehalem it NOPs and the subsequent cmp
    // sees whatever was in rax (code then branches to non-shadow path).
    // The rest of CET_SS (WRSSD/RSTORSSP/SETSSBSY/etc.) is NOT hint-space
    // and remains flagged.
    if matches!(
        insn.mnemonic(),
        Mnemonic::Rdsspd | Mnemonic::Rdsspq | Mnemonic::Incsspd | Mnemonic::Incsspq
    ) {
        return true;
    }

    false
}

fn is_allowed(feat: CpuidFeature) -> bool {
    NEHALEM_ALLOWED.contains(&feat)
}

/// Features that can only appear via data-in-text misdecoding — a byte
/// sequence in a jump table or literal pool that happens to decode as an
/// instruction from a defunct or privileged ISA extension.
///
/// 3DNow! was removed from silicon by 2010. SMM's RSM is ring-0. Cyrix/Geode/
/// Padlock never had a mainstream toolchain. No compiler targeting x86-64 in
/// any configuration emits these — their presence in a scan means a linear
/// sweep walked through inline data.
///
/// MSVC inlines jump tables in .text (LLVM puts them in .rodata), so this
/// matters on PE more than ELF.
fn is_impossible_feature(feat: CpuidFeature) -> bool {
    use CpuidFeature as F;
    matches!(
        feat,
        F::D3NOW
            | F::D3NOWEXT
            | F::CYRIX_D3NOW
            | F::SMM
            | F::CYRIX_SMM
            | F::CYRIX_SMINT
            | F::CYRIX_SMINT_0F7E
            | F::CYRIX_SHR
            | F::CYRIX_DDI
            | F::CYRIX_EMMI
            | F::CYRIX_DMI
            | F::CYRIX_FPU
            | F::PADLOCK_ACE
            | F::PADLOCK_PHE
            | F::PADLOCK_PMM
            | F::PADLOCK_RNG
            | F::PADLOCK_GMI
            | F::PADLOCK_UNDOC
    )
}

/// Canonicalize a symbol name so that build-volatile parts of Rust's v0
/// mangling compare equal across target triples and toolchain versions.
///
/// The allowlist uses the literal placeholder `<rust-hash>` where a crate
/// disambiguator would sit. At match time we apply the same canonicalization
/// to symbols from the binary, then compare exact strings. The allowlist
/// entry
///
///   _RNvMNtNtNtNt<rust-hash>6memchr4arch6x86_644avx26memchrNtB2_3One13find_raw_avx2
///
/// thus matches both the glibc build (Cs5QMN7YRSXc3_) and the musl build
/// (Cs7xpxyTGGNU3_), and survives `rust-toolchain.toml` bumps.
///
/// Two substitutions:
///
/// - `Cs[0-9A-Za-z]+_` → `<rust-hash>`
///   This is the Rust v0 crate disambiguator: `C` (crate root),
///   `s` (disambiguator follows), a base-62 hash derived from
///   `-C metadata=` (which cargo computes from crate+version+features+
///   target-triple), then `_` terminator. The *rest* of the mangled path
///   — function name, module path, generic args — is left intact, so the
///   match is still one specific function, not a wildcard.
///
/// - `.llvm.[0-9]+` suffix → stripped
///   LLVM's per-build internalisation ID (e.g. `__xgetbv.llvm.21110093...`).
///   Pure noise.
///
/// Non-Rust symbols pass through unchanged: the `Cs[alnum]+_` pattern is
/// specific enough not to collide with C/C++/asm names in practice (it
/// requires an uppercase C immediately followed by lowercase s and a
/// trailing underscore after alphanumerics — checked against all 79k
/// symbols in the real binary, zero false hits).
fn canonicalize_symbol(name: &str) -> String {
    // Strip .llvm.NNNN first so we don't match inside it.
    let base = match name.rfind(".llvm.") {
        Some(i) if name[i + 6..].bytes().all(|b| b.is_ascii_digit()) => &name[..i],
        _ => name,
    };

    // Scan for Cs<base62>_ and replace. Hand-rolled rather than pulling in
    // the regex crate for one pattern. The disambiguator is base-62
    // (0-9 A-Z a-z), at least one char, terminated by '_'.
    let bytes = base.as_bytes();
    let mut out = String::with_capacity(base.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'C' && bytes.get(i + 1) == Some(&b's') {
            // Scan the putative hash.
            let mut j = i + 2;
            while j < bytes.len() && bytes[j].is_ascii_alphanumeric() {
                j += 1;
            }
            // Require: at least one hash char, and '_' after.
            if j > i + 2 && bytes.get(j) == Some(&b'_') {
                out.push_str("<rust-hash>");
                i = j + 1;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Symbol-table entry for address→name attribution. Sorted by address so
/// we can binary-search for the symbol containing any given instruction.
#[derive(Debug)]
struct Sym {
    addr: u64,
    end: u64,
    name: String,
}

fn build_symbol_table(file: &object::File) -> Vec<Sym> {
    // Collect ALL defined text-section symbols, including zero-size ones.
    // Hand-written asm often omits .size directives; dropping those labels
    // would leave their function bodies as <no-symbol@...> and unallowlistable.
    // Instead we accept them and synthesize an end = next symbol's start.
    //
    // Raw collect: (addr, declared_size, name). Size may be 0.
    // Can't use is_definition(): object's ELF impl returns false for
    // STT_NOTYPE + size==0 (symbol.rs:529), which drops exactly the asm
    // labels we need. Instead check that the symbol lives in a real section
    // (SymbolSection::Section(_) — excludes Undefined/Common/Absolute).
    let collect = |iter: object::SymbolIterator| -> Vec<(u64, u64, String)> {
        iter.filter(|s| {
            matches!(s.kind(), SymbolKind::Text | SymbolKind::Unknown)
                && matches!(s.section(), SymbolSection::Section(_))
                && s.name()
                    .map(|n| {
                        // Drop anonymous section markers and ARM EABI mapping
                        // symbols ($x = A64 code, $d = data, $t = Thumb). They're
                        // zero-size markers at code/data transitions and would
                        // otherwise shadow the real function at the same address.
                        !n.is_empty() && !n.starts_with('$')
                    })
                    .unwrap_or(false)
        })
        .filter_map(|s| Some((s.address(), s.size(), s.name().ok()?.to_owned())))
        .collect()
    };

    let mut raw = collect(file.symbols());
    if raw.is_empty() {
        // Fallback for stripped binaries. Release bun keeps .symtab but
        // musl static builds sometimes strip harder.
        raw = collect(file.dynamic_symbols());
    }

    // Sort, then prefer the sized symbol when two share an address (e.g.
    // `foo` and `.Lfoo_begin` at the same addr — we want the real one).
    raw.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    raw.dedup_by(|later, earlier| later.0 == earlier.0);

    // Section ends bound zero-size symbols at section tail so they don't
    // extend into .rodata or whatever comes next.
    let mut section_ends: Vec<u64> = file
        .sections()
        .filter(|s| s.kind() == SectionKind::Text)
        .filter_map(|s| s.address().checked_add(s.size()))
        .collect();
    section_ends.sort();

    let mut syms = Vec::with_capacity(raw.len());
    for i in 0..raw.len() {
        let (addr, size, name) = (raw[i].0, raw[i].1, raw[i].2.clone());
        let end = if size > 0 {
            addr.saturating_add(size)
        } else {
            // Synthesize: extend to whichever comes first, the next symbol
            // or the containing section's end.
            let next_sym = raw.get(i + 1).map(|r| r.0).unwrap_or(u64::MAX);
            let sec_end = section_ends
                .iter()
                .copied()
                .find(|&e| e > addr)
                .unwrap_or(u64::MAX);
            next_sym.min(sec_end)
        };
        if end > addr {
            syms.push(Sym { addr, end, name });
        }
    }
    syms
}

/// Load symbols from an MSVC PDB. PE executables don't carry a .symtab like
/// ELF does — everything lives in a companion .pdb file produced by the
/// linker. Without it, a Windows scan decodes fine but every hit is
/// <no-symbol@ADDR> and the allowlist is useless.
///
/// The PDB stores addresses as (section_index, offset) pairs. The address_map
/// stream converts those to RVAs (offsets from the image base as loaded in
/// memory). The PE header stores the preferred image base. iced's `ip` is the
/// full VA, which object gives us via `section.address()` = image_base + RVA.
/// So: VA = relative_address_base() + RVA.
fn build_symbol_table_pdb(pdb_path: &Path, file: &object::File) -> Result<Vec<Sym>, String> {
    let f = std::fs::File::open(pdb_path)
        .map_err(|e| format!("opening pdb {}: {}", pdb_path.display(), e))?;
    let mut pdb =
        pdb::PDB::open(f).map_err(|e| format!("parsing pdb {}: {}", pdb_path.display(), e))?;

    let address_map = pdb
        .address_map()
        .map_err(|e| format!("pdb address_map: {e}"))?;
    let image_base = file.relative_address_base();

    // Bound symbols to executable sections so a public symbol in .rdata
    // (rare but it happens — exported constants) doesn't get a synthesized
    // range that spans into the next function.
    let text_ranges: Vec<(u64, u64)> = file
        .sections()
        .filter(|s| s.kind() == SectionKind::Text)
        .filter_map(|s| Some((s.address(), s.address().checked_add(s.size())?)))
        .collect();
    let in_text = |va: u64| text_ranges.iter().any(|&(lo, hi)| va >= lo && va < hi);

    // SymbolIter implements pdb::FallibleIterator, not std::iter::Iterator —
    // .next() is a trait method that needs the trait in scope.
    use pdb::FallibleIterator;

    let mut raw: Vec<(u64, u64, String)> = Vec::new();

    // ---- Pass 1: DBI module stream (S_LPROC32/S_GPROC32) ----
    // Per-compiland records, one per function, with an actual byte-length.
    // The dense source: covers every static function the public stream can't
    // see. module_info() returns Option — some modules are import-only stubs
    // with no symbol substream.
    //
    // We also collect each module's object-file name while iterating, for use
    // in pass 3 below. Section contributions (pass 3) reference modules by
    // index into this same ordering.
    let dbi = pdb
        .debug_information()
        .map_err(|e| format!("pdb dbi: {e}"))?;
    let mut module_names: Vec<String> = Vec::new();
    let mut modules = dbi.modules().map_err(|e| format!("pdb modules: {e}"))?;
    while let Some(module) = modules
        .next()
        .map_err(|e| format!("pdb modules.next: {e}"))?
    {
        // The linker records the full build-machine path:
        //   D:\build\release\foo.lib     (archive, all members collapsed)
        //   C:\...\libucrt.lib           (CRT archive)
        //   foo.obj                       (loose object)
        // Build paths churn; library basenames don't. Keep the leaf.
        let obj_name = module.object_file_name().to_string();
        let leaf = obj_name
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(&obj_name)
            .to_string();
        module_names.push(leaf);
        let Some(info) = pdb
            .module_info(&module)
            .map_err(|e| format!("pdb module_info: {e}"))?
        else {
            continue;
        };
        let mut syms = info
            .symbols()
            .map_err(|e| format!("pdb module symbols: {e}"))?;
        while let Some(sym) = syms.next().map_err(|e| format!("pdb sym iter: {e}"))? {
            // S_LPROC32 (local/static) and S_GPROC32 (global) both land in
            // SymbolData::Procedure. .len is the real function body length
            // in bytes — no gap-synthesis needed for these.
            let parsed: Result<pdb::SymbolData, _> = sym.parse();
            let Ok(pdb::SymbolData::Procedure(p)) = parsed else {
                continue;
            };
            let Some(rva) = p.offset.to_rva(&address_map) else {
                continue;
            };
            let va = image_base + u64::from(rva.0);
            if !in_text(va) {
                continue;
            }
            raw.push((va, u64::from(p.len), p.name.to_string().into_owned()));
        }
    }

    // ---- Pass 2: S_PUB32 (public symbols) ----
    // Address markers, no sizes. The DBI pass above usually covers everything,
    // but hand-written asm compiled through MASM sometimes emits a PUBLIC label
    // without a corresponding PROC/.ENDP frame — no S_*PROC32 record, only an
    // S_PUB32. The dedup below discards these where a DBI record already covers
    // the address; where it doesn't, the zero size gets a synthesized end in
    // the finalize pass (bounded by the next symbol of any kind).
    let global_syms = pdb
        .global_symbols()
        .map_err(|e| format!("pdb global_symbols: {e}"))?;
    let mut iter = global_syms.iter();
    while let Some(sym) = iter.next().map_err(|e| format!("pdb iter: {e}"))? {
        let parsed: Result<pdb::SymbolData, _> = sym.parse();
        let Ok(pdb::SymbolData::Public(p)) = parsed else {
            continue;
        };
        let Some(rva) = p.offset.to_rva(&address_map) else {
            continue;
        };
        let va = image_base + u64::from(rva.0);
        if !in_text(va) {
            continue;
        }
        raw.push((va, 0, p.name.to_string().into_owned()));
    }

    // Finalize the PDB-named symbols FIRST, without .pdata entries in the mix.
    // Zero-size S_PUB32 markers for hand-written asm need their synthetic end
    // to reach the next *named* symbol. A .pdata entry nested inside such a
    // routine (covering an inner loop with its own unwind info) would
    // otherwise truncate the public's range and strand the rest of the
    // function as <no-symbol>.
    raw.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    raw.dedup_by(|later, earlier| later.0 == earlier.0);

    let mut section_ends: Vec<u64> = text_ranges.iter().map(|&(_, e)| e).collect();
    section_ends.sort();

    let mut syms = Vec::with_capacity(raw.len());
    for i in 0..raw.len() {
        let (addr, size, name) = (raw[i].0, raw[i].1, raw[i].2.clone());
        let end = if size > 0 {
            addr.saturating_add(size)
        } else {
            let next_sym = raw.get(i + 1).map(|r| r.0).unwrap_or(u64::MAX);
            let sec_end = section_ends
                .iter()
                .copied()
                .find(|&e| e > addr)
                .unwrap_or(u64::MAX);
            next_sym.min(sec_end)
        };
        if end > addr {
            syms.push(Sym { addr, end, name });
        }
    }

    // ---- Pass 3: DBI section contributions — ONLY where nothing above reaches ----
    // One record per (output section, source object) pair: "module M contributed
    // bytes [offset, offset+size) of section S". This is the linker-map data in
    // structured form — it tells you which .obj/.lib every byte came from, even
    // when that .obj shipped no per-function symbols (stripped CRT, Rust
    // staticlib std helpers that LTO anonymized).
    //
    // Attribution is by library basename: <lib:foo.lib>. That name is stable
    // across link reorderings and unrelated code changes — it only moves if
    // the archive itself gets renamed.
    //
    // Multiple contributions from the same library collapse to one allowlist
    // entry. Unlike the .pdata-RVA approach this replaces, the result doesn't
    // churn when addresses shift.
    // Collect gap-fillers into a scratch vec so symbol_for() keeps operating
    // on the sorted pass-1/2 table. Pushing directly into `syms` mid-iteration
    // would break the binary search invariant.
    let mut gap_fillers: Vec<Sym> = Vec::new();
    let mut contribs = dbi
        .section_contributions()
        .map_err(|e| format!("pdb section_contributions: {e}"))?;
    while let Some(c) = contribs
        .next()
        .map_err(|e| format!("pdb contrib iter: {e}"))?
    {
        let Some(rva) = c.offset.to_rva(&address_map) else {
            continue;
        };
        let begin = image_base + u64::from(rva.0);
        let end = begin + u64::from(c.size);
        if c.size == 0 || !in_text(begin) {
            continue;
        }
        // Already covered by a named symbol? symbol_for() is the same lookup
        // the scan loop uses, so this is exactly "would this address get a
        // real name or <no-symbol>".
        if symbol_for(&syms, begin).is_some() {
            continue;
        }
        let lib = module_names
            .get(c.module)
            .map(String::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or("unknown");
        gap_fillers.push(Sym {
            addr: begin,
            end,
            name: format!("<lib:{lib}>"),
        });
    }
    syms.extend(gap_fillers);
    syms.sort_by_key(|s| s.addr);

    Ok(syms)
}

/// Binary search for the symbol whose [addr, end) range contains `ip`.
/// Returns None for padding between functions or stripped regions.
fn symbol_for(syms: &[Sym], ip: u64) -> Option<&Sym> {
    // partition_point gives the index of the first sym with addr > ip.
    // The candidate is the one before it.
    let i = syms.partition_point(|s| s.addr <= ip);
    if i == 0 {
        return None;
    }
    let cand = &syms[i - 1];
    if ip < cand.end {
        Some(cand)
    } else {
        None
    }
}

/// Allowlist: canonical symbol name → optional feature ceiling.
///
/// `None` means "any feature inside this symbol is allowed" (blanket pass).
/// `Some(set)` means "only these features are allowed" — if a scan finds a
/// feature not in the set, that's a violation even though the symbol is
/// allowlisted.
///
/// An entry with a ceiling would FAIL if a later scan finds a feature not
/// in the bracket list — e.g. a dependency bump adds AVX512F inside a symbol
/// previously ceilinged at [AVX, AVX2]. Widening the bracket is the explicit
/// checkpoint where someone asks "did the gate also get updated?"
type Allowlist = HashMap<String, Option<HashSet<String>>>;

fn load_allowlist_into(path: &Path, out: &mut Allowlist) -> Result<(), String> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            eprintln!(
                "note: allowlist not found at {}, treating as empty",
                path.display()
            );
            return Ok(());
        }
        Err(e) => return Err(format!("reading allowlist {}: {}", path.display(), e)),
    };
    for (lineno, raw) in text.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        // `symbol` or `symbol [FEAT, FEAT, ...]`. A lone `[` opens the
        // ceiling; no `[` means blanket pass.
        let (sym_part, ceiling) = match line.split_once('[') {
            None => (line, None),
            Some((s, rest)) => {
                let inner = rest.strip_suffix(']').ok_or_else(|| {
                    format!(
                        "{}:{}: unclosed '[' in feature list",
                        path.display(),
                        lineno + 1
                    )
                })?;
                let feats: HashSet<String> = inner
                    .split(',')
                    .map(|f| f.trim().to_owned())
                    .filter(|f| !f.is_empty())
                    .collect();
                (s.trim(), Some(feats))
            }
        };
        // Canonicalize here too — an allowlist entry with a literal Cs<hash>_
        // pasted from a scan should also match after a toolchain bump.
        // Entries already using <rust-hash> pass through unchanged ('<' isn't
        // alphanumeric, so the scanner won't touch it).
        // When merging multiple allowlists, the same symbol may appear with
        // different ceilings. Union the feature sets; if either side is a
        // blanket pass (None), the result is a blanket pass.
        let key = canonicalize_symbol(sym_part);
        match out.get_mut(&key) {
            None => {
                out.insert(key, ceiling);
            }
            Some(existing @ Some(_)) => match ceiling {
                None => *existing = None,
                Some(extra) => existing.as_mut().unwrap().extend(extra),
            },
            Some(None) => {} // already a blanket pass; keep it
        }
    }
    Ok(())
}

/// One violating instruction. Architecture-neutral: mnemonic and feature are
/// pre-formatted strings so the bucketing/reporting path is shared between
/// the x64 (iced) and aarch64 (raw-pattern) decoders.
struct Hit {
    ip: u64,
    mnemonic: &'static str,
    feature: &'static str,
}

/// Per-symbol aggregate. Keyed by symbol name in a BTreeMap so output is
/// deterministic (sorted) — makes diffs between CI runs readable.
#[derive(Default)]
struct SymReport {
    hits: Vec<Hit>,
    /// Union of all features seen in this symbol, for the summary line.
    features: HashSet<&'static str>,
}

type Buckets = BTreeMap<String, SymReport>;

/// Outcome of scanning one text section. Shared return shape for both arches.
struct ScanResult {
    violations: Buckets,
    allowlisted: Buckets,
    total_insns: u64,
}

fn record(
    ip: u64,
    mnemonic: &'static str,
    feature: &'static str,
    syms: &[Sym],
    allowlist: &Allowlist,
    violations: &mut Buckets,
    allowlisted: &mut Buckets,
) {
    let raw_sym = symbol_for(syms, ip)
        .map(|s| s.name.clone())
        .unwrap_or_else(|| format!("<no-symbol@{ip:#x}>"));
    // Compare canonical forms (Rust hash stripped) but report the raw name —
    // devs grepping objdump need the real mangled string.
    let canon = canonicalize_symbol(&raw_sym);

    // Three-way outcome:
    //   not in allowlist                           → violation
    //   in allowlist, no ceiling                   → suppressed
    //   in allowlist, ceiling contains this feat   → suppressed
    //   in allowlist, ceiling DOESN'T contain it   → violation (the
    //     "symbol grew past its gate" case — the whole point of ceilings)
    let bucket = match allowlist.get(&canon) {
        None => violations,
        Some(None) => allowlisted,
        Some(Some(ceiling)) if ceiling.contains(feature) => allowlisted,
        Some(Some(_)) => violations,
    };
    let entry = bucket.entry(raw_sym).or_default();
    entry.features.insert(feature);
    entry.hits.push(Hit {
        ip,
        mnemonic,
        feature,
    });
}

/// x64 decode + classify. iced provides exact per-instruction CpuidFeature.
fn scan_x86_64(bytes: &[u8], sec_addr: u64, syms: &[Sym], allowlist: &Allowlist) -> ScanResult {
    let mut violations = Buckets::new();
    let mut allowlisted = Buckets::new();
    let mut total_insns = 0u64;

    // Linear sweep. iced handles variable-length encoding; on undecodable
    // bytes (data-in-text) it returns Code::INVALID and we skip. False
    // positives from data-in-text are rare in practice — LLVM puts jump
    // tables in .rodata, not inline.
    let mut decoder = Decoder::with_ip(64, bytes, sec_addr, DecoderOptions::NONE);
    let mut insn = Instruction::default();
    while decoder.can_decode() {
        decoder.decode_out(&mut insn);
        if insn.is_invalid() {
            continue;
        }
        total_insns += 1;

        let feats = insn.cpuid_features();
        // Fast path: no post-baseline features at all (the common case).
        if feats.iter().copied().all(is_allowed) {
            continue;
        }
        if is_harmless_on_nehalem(&insn) {
            continue;
        }

        // iced's Mnemonic and CpuidFeature are repr'd via tables with static
        // &str names behind their Debug impls, but there's no public stable
        // accessor. Leak the Debug repr once per hit — tiny volume (tens of
        // thousands of hits max, each a few bytes; a KB or so for a full scan).
        let mnem: &'static str = Box::leak(format!("{:?}", insn.mnemonic()).into_boxed_str());
        // Record EVERY post-baseline feature, not just the first one found.
        // Multi-feature instructions (e.g. VPCLMULQDQ requires AVX+PCLMULQDQ)
        // must check each feature against the ceiling independently — if the
        // ceiling says [AVX] but PCLMULQDQ is also required, that's a violation.
        for bad_feat in feats.iter().copied().filter(|f| !is_allowed(*f)) {
            if is_impossible_feature(bad_feat) {
                continue;
            }
            let feat: &'static str = Box::leak(format!("{:?}", bad_feat).into_boxed_str());
            record(
                insn.ip(),
                mnem,
                feat,
                syms,
                allowlist,
                &mut violations,
                &mut allowlisted,
            );
        }
    }

    ScanResult {
        violations,
        allowlisted,
        total_insns,
    }
}

/// ARM EABI mapping symbols tell us where inline data lives inside .text.
/// `$x` (or `$x.<n>`) marks the start of A64 code; `$d` marks data
/// (literal pools, jump tables, inline strings). Consecutive mapping
/// symbols partition .text into code/data chunks. Without honouring
/// these, inline strings after a `ret` would be decoded as garbage
/// instructions — and garbage has a ~6% chance of landing in the SVE
/// encoding space.
///
/// Returns a sorted list of [start, end) address ranges that are data.
/// The aarch64 scanner binary-searches against this to skip those words.
fn aarch64_data_ranges(file: &object::File) -> Vec<(u64, u64)> {
    // Mapping symbols exist in non-text sections too (.debug_line gets `$d`,
    // .ARM.exidx gets them, etc.). In a relocatable .o those are all at
    // address 0 and would eat the entire address space if not filtered.
    let text_sections: HashSet<_> = file
        .sections()
        .filter(|s| s.kind() == SectionKind::Text)
        .map(|s| s.index())
        .collect();

    // Collect mapping symbols in text sections: (address, is_data).
    // These are STT_NOTYPE, LOCAL, size 0, name `$x`/`$d` with an optional
    // `.<suffix>` (the ARM EABI permits `$x.foo` for local uniqueness).
    let mut marks: Vec<(u64, bool)> = file
        .symbols()
        .filter_map(|s| {
            let SymbolSection::Section(idx) = s.section() else {
                return None;
            };
            if !text_sections.contains(&idx) {
                return None;
            }
            let n = s.name().ok()?;
            let is_data = n == "$d" || n.starts_with("$d.");
            let is_code = n == "$x" || n.starts_with("$x.");
            if !is_data && !is_code {
                return None;
            }
            Some((s.address(), is_data))
        })
        .collect();
    marks.sort_by_key(|m| m.0);

    // Section ends bound trailing $d markers so a data pool at the very end
    // of .text doesn't extend to u64::MAX.
    let mut section_ends: Vec<u64> = file
        .sections()
        .filter(|s| s.kind() == SectionKind::Text)
        .filter_map(|s| s.address().checked_add(s.size()))
        .collect();
    section_ends.sort();

    // Walk the marks: each $d starts a data range that ends at the next
    // mark of any kind (the next $x closes it; a consecutive $d is a no-op
    // because the next iteration's start == this one's end).
    let mut ranges = Vec::new();
    for (i, &(addr, is_data)) in marks.iter().enumerate() {
        if !is_data {
            continue;
        }
        let end = marks
            .get(i + 1)
            .map(|m| m.0)
            .or_else(|| section_ends.iter().copied().find(|&e| e > addr))
            .unwrap_or(u64::MAX);
        if end > addr {
            ranges.push((addr, end));
        }
    }
    ranges
}

/// aarch64 decode + classify. Fixed-width 4-byte instructions — iterate u32
/// words and match bit patterns directly. No disassembler involved.
fn scan_aarch64(
    bytes: &[u8],
    sec_addr: u64,
    syms: &[Sym],
    allowlist: &Allowlist,
    data_ranges: &[(u64, u64)],
) -> ScanResult {
    let mut violations = Buckets::new();
    let mut allowlisted = Buckets::new();
    let mut total_insns = 0u64;

    // ARM64 padding is NOP (0xD503201F) or zeros — neither matches any of our
    // classify() patterns — so we don't need to special-case tail slop.
    // chunks_exact(4) naturally drops any trailing 1-3 bytes.
    for (i, chunk) in bytes.chunks_exact(4).enumerate() {
        let ip = sec_addr + (i as u64) * 4;
        // Skip literal-pool data. data_ranges is sorted; partition_point finds
        // the first range whose start is > ip, so the candidate is the one
        // before it.
        let dr = data_ranges.partition_point(|r| r.0 <= ip);
        if dr > 0 && ip < data_ranges[dr - 1].1 {
            continue;
        }
        let w = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        total_insns += 1;
        let Some(feat) = aarch64::classify(w) else {
            continue;
        };
        record(
            ip,
            aarch64::rough_mnemonic(w, feat),
            feat.name(),
            syms,
            allowlist,
            &mut violations,
            &mut allowlisted,
        );
    }

    ScanResult {
        violations,
        allowlisted,
        total_insns,
    }
}

struct Args {
    binary: PathBuf,
    allowlists: Vec<PathBuf>,
    pdb: Option<PathBuf>,
}

fn parse_args() -> Result<Args, String> {
    let mut binary: Option<PathBuf> = None;
    let mut allowlists: Vec<PathBuf> = Vec::new();
    let mut pdb: Option<PathBuf> = None;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--binary" => binary = Some(it.next().ok_or("--binary needs a path")?.into()),
            "--allowlist" => allowlists.push(it.next().ok_or("--allowlist needs a path")?.into()),
            "--pdb" => pdb = Some(it.next().ok_or("--pdb needs a path")?.into()),
            "--target" => {
                // Informational only. Actual target is inferred from the
                // binary's ELF e_machine field, which is the unambiguous
                // source of truth. Accepted for CLI symmetry with the
                // emulator-based verify-baseline.ts.
                let t = it.next().ok_or("--target needs a value")?;
                if !matches!(t.as_str(), "nehalem" | "cortex-a53") {
                    return Err(format!(
                        "unsupported target '{t}' (expected 'nehalem' or 'cortex-a53')"
                    ));
                }
            }
            "-h" | "--help" => {
                return Err("usage: verify-baseline-static --binary <path> [--allowlist <path>]... [--pdb <path>]".into())
            }
            _ => return Err(format!("unknown argument: {a}")),
        }
    }
    let binary = binary.ok_or("--binary is required")?;
    if allowlists.is_empty() {
        allowlists.push(
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("allowlist-x64.txt")))
                .unwrap_or_else(|| PathBuf::from("allowlist-x64.txt")),
        );
    }
    // PDB default: <binary>.pdb (foo.exe → foo.pdb). Only consulted if the
    // binary turns out to be a PE and the file actually exists — a bogus
    // guess here for an ELF is harmless, we just won't open it.
    let pdb = pdb.or_else(|| {
        let guess = binary.with_extension("pdb");
        guess.exists().then_some(guess)
    });
    Ok(Args {
        binary,
        allowlists,
        pdb,
    })
}

fn run() -> Result<bool, String> {
    let args = parse_args()?;
    let mut allowlist = Allowlist::new();
    for path in &args.allowlists {
        load_allowlist_into(path, &mut allowlist)?;
    }

    let data =
        fs::read(&args.binary).map_err(|e| format!("reading {}: {}", args.binary.display(), e))?;
    let file = object::File::parse(&*data)
        .map_err(|e| format!("parsing {}: {}", args.binary.display(), e))?;

    // Pick the scanner based on the ELF machine type. This is the single
    // source of truth — a linux-aarch64 binary fed to this tool will get
    // aarch64 checking regardless of what --target says.
    let arch = file.architecture();
    let target_desc = match arch {
        object::Architecture::X86_64 => "x86-64 Nehalem (no AVX/AES-NI/BMI)",
        object::Architecture::Aarch64 => "aarch64 armv8-a+crc (no LSE/SVE/RCPC)",
        other => {
            return Err(format!(
                "{}: architecture {:?} not supported (have x86_64, aarch64)",
                args.binary.display(),
                other
            ))
        }
    };

    // PE has no in-binary .symtab — everything's in a companion .pdb.
    // For ELF the PDB arg is ignored (even if someone passes one).
    let is_pe = matches!(file.format(), object::BinaryFormat::Pe);
    let syms = match (is_pe, &args.pdb) {
        (true, Some(pdb_path)) => build_symbol_table_pdb(pdb_path, &file)?,
        (true, None) => {
            eprintln!(
                "note: PE binary without --pdb; attribution will be <no-symbol@ADDR>. \
                 Pass --pdb <path> (default: <binary>.pdb if present)."
            );
            build_symbol_table(&file)
        }
        (false, _) => build_symbol_table(&file),
    };
    // Only aarch64 uses mapping symbols for data skipping. On x64, LLVM puts
    // jump tables in .rodata so literal-pool false positives are a non-issue.
    let data_ranges = if arch == object::Architecture::Aarch64 {
        aarch64_data_ranges(&file)
    } else {
        Vec::new()
    };

    eprintln!(
        "scanning {} ({} bytes, {} symbols, {} data ranges) against {}",
        args.binary.display(),
        data.len(),
        syms.len(),
        data_ranges.len(),
        target_desc
    );

    let mut violations = Buckets::new();
    let mut allowlisted = Buckets::new();
    let mut total_insns: u64 = 0;
    let mut text_sections = 0;

    for section in file.sections() {
        if section.kind() != SectionKind::Text {
            continue;
        }
        text_sections += 1;
        let bytes = section
            .data()
            .map_err(|e| format!("reading section {:?}: {}", section.name(), e))?;

        let res = match arch {
            object::Architecture::X86_64 => {
                scan_x86_64(bytes, section.address(), &syms, &allowlist)
            }
            object::Architecture::Aarch64 => {
                scan_aarch64(bytes, section.address(), &syms, &allowlist, &data_ranges)
            }
            _ => unreachable!(),
        };
        total_insns += res.total_insns;
        // Merge per-section buckets into the global ones. Sections are small
        // in number (5 in a real bun binary); this is cheap.
        for (sym, rep) in res.violations {
            let e = violations.entry(sym).or_default();
            e.features.extend(rep.features);
            e.hits.extend(rep.hits);
        }
        for (sym, rep) in res.allowlisted {
            let e = allowlisted.entry(sym).or_default();
            e.features.extend(rep.features);
            e.hits.extend(rep.hits);
        }
    }

    eprintln!(
        "decoded {} instructions across {} text section(s)",
        total_insns, text_sections
    );
    eprintln!();

    // ------- Report -------

    if !violations.is_empty() {
        println!("VIOLATIONS (would SIGILL on {}):", target_desc);
        println!();
        for (sym, rep) in &violations {
            let mut feats: Vec<_> = rep.features.iter().copied().collect();
            feats.sort();
            println!(
                "  {}  [{}]  ({} insns)",
                sym,
                feats.join(", "),
                rep.hits.len()
            );
            // Show first few instructions so the developer can quickly verify
            // with objdump. Full dump would be noisy for big asm kernels.
            for h in rep.hits.iter().take(3) {
                println!("    {:#012x}  {}  ({})", h.ip, h.mnemonic, h.feature);
            }
            if rep.hits.len() > 3 {
                println!("    ... {} more", rep.hits.len() - 3);
            }
        }
        println!();
    }

    if !allowlisted.is_empty() {
        println!("ALLOWLISTED (suppressed, runtime-dispatched):");
        let mut total_allowed_insns = 0usize;
        for (sym, rep) in &allowlisted {
            total_allowed_insns += rep.hits.len();
            let mut feats: Vec<_> = rep.features.iter().copied().collect();
            feats.sort();
            println!(
                "  {}  [{}]  ({} insns)",
                sym,
                feats.join(", "),
                rep.hits.len()
            );
        }
        println!(
            "  -- {} symbols, {} instructions total",
            allowlisted.len(),
            total_allowed_insns
        );
        println!();
    }

    // Allowlist entries that never matched are suspicious — the symbol may
    // have been renamed or removed and the allowlist is now stale. Compare
    // canonical forms on both sides so a hash-only change isn't flagged.
    // An allowlist entry is NOT stale just because some of its instructions
    // broke through a feature ceiling into `violations` — the symbol still
    // exists and still matched, the entry just needs its bracket list updated.
    // So stale = never hit in EITHER bucket.
    let hit_canon: HashSet<_> = allowlisted
        .keys()
        .chain(violations.keys())
        .map(|s| canonicalize_symbol(s))
        .collect();
    let mut stale: Vec<_> = allowlist
        .keys()
        .filter(|k| !hit_canon.contains(*k))
        .collect();
    stale.sort();
    if !stale.is_empty() {
        println!("STALE ALLOWLIST ENTRIES (no matching symbol found — remove these?):");
        for s in &stale {
            println!("  {}", s);
        }
        println!();
    }

    // ------- Summary -------
    let total_violation_insns: usize = violations.values().map(|r| r.hits.len()).sum();
    println!("SUMMARY:");
    println!(
        "  violations:  {} symbols, {} instructions",
        violations.len(),
        total_violation_insns
    );
    println!("  allowlisted: {} symbols", allowlisted.len());
    println!("  stale allowlist entries: {}", stale.len());

    if violations.is_empty() {
        println!("  PASS");
        Ok(true)
    } else {
        println!("  FAIL");
        println!();
        println!("To allowlist a symbol (after verifying it's runtime-gated), add it to:");
        for p in &args.allowlists {
            println!("  {}", p.display());
        }
        Ok(false)
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(2)
        }
    }
}
