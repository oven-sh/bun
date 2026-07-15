/**
 * Rust regular-LTO summary fix-up — the ninja build-time CLI for the
 * `rust_lto_fix` rule (see `rustLtoLinkInputs()` in rust.ts and the
 * `rustc-no-regular-lto-summary` entry in workarounds.ts).
 *
 * ## Why this exists
 *
 * The ELF release link is full (regular) LTO: every C/C++ object — ours,
 * the direct deps', the WebKit `-lto` prebuilts' — is clang full-LTO
 * bitcode, and clang unconditionally writes a per-module *regular-LTO
 * summary* with `EnableSplitLTOUnit=1` into such objects on ELF
 * (`shouldEmitRegularLTOSummary()` in clang's BackendUtil; neither
 * `-fno-split-lto-unit` nor any other driver flag turns that off).
 *
 * The Rust side reaches the link as `-Clinker-plugin-lto` + `lto = "fat"`
 * bitcode: one merged module with *no* summary at all. lld's
 * `getLTOInfo()` reports a summary-less module as `EnableSplitLTOUnit=0`,
 * the link becomes "partially split", and because `-fwhole-program-vtables`
 * puts `llvm.type.test` calls in the merged C++ module,
 * `LTO::checkPartiallySplit()` aborts the link with
 * "inconsistent LTO Unit splitting (recompile with -fsplit-lto-unit)".
 * rustc has no option to emit a regular-LTO summary, so this step bolts
 * one on:
 *
 *   1. extract the bitcode member(s) from `libbun_rust.a`,
 *   2. `llvm-link` in a stub that adds the `ThinLTO=0` module flag — that
 *      flag is what makes the bitcode writer emit a FULL_LTO summary block
 *      instead of a ThinLTO one,
 *   3. re-emit with `opt --module-summary`, which builds the per-module
 *      summary from the IR. Its `EnableSplitLTOUnit` bit is copied from the
 *      module flag that `-Zsplit-lto-unit` stamped on every CGU (rust.ts
 *      passes it on ELF for exactly this reason), so the result matches the
 *      clang objects and the consistency check passes.
 *
 * The tools must come from rustc's own LLVM (the rustup `llvm-tools`
 * component, installed next to rust-lld) — clang's older LLVM cannot read
 * rustc's newer bitcode. If the component is missing, this script installs
 * it (`rustup component add llvm-tools`), mirroring how the
 * `rust_build_cross` rule self-heals missing `rust-std` targets on CI
 * agents that pin the toolchain via `RUSTUP_TOOLCHAIN`.
 *
 * argv: [node, rust-lto-fix-cli.ts, <libbun_rust.a>, <out.o>, <llvm-bin-dir>, <ar>]
 */

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BuildError, assert } from "./error.ts";

/** Absolute path to this file — referenced by the `rust_lto_fix` ninja rule. */
export const rustLtoFixCliPath: string = import.meta.filename;

/** Run a tool, streaming its output; throw a BuildError on failure. */
function run(cmd: string, args: string[], cwd?: string): void {
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd });
  if (res.error !== undefined || res.status !== 0) {
    throw new BuildError(`${cmd} ${args.join(" ")} failed${res.status !== null ? ` (exit ${res.status})` : ""}`, {
      cause: res.error,
    });
  }
}

/** First bytes of an LLVM bitcode file: 'BC\xC0\xDE', or the wrapper magic 0x0B17C0DE (LE). */
function isBitcode(path: string): boolean {
  const buf = Buffer.alloc(4);
  const fd = openSync(path, "r");
  try {
    if (readSync(fd, buf, 0, 4, 0) < 4) return false;
  } finally {
    closeSync(fd);
  }
  if (buf[0] === 0x42 && buf[1] === 0x43 && buf[2] === 0xc0 && buf[3] === 0xde) return true;
  return buf[0] === 0xde && buf[1] === 0xc0 && buf[2] === 0x17 && buf[3] === 0x0b;
}

/**
 * Make sure llvm-link/opt/llvm-as exist in rustc's host tool dir. They ship
 * with the rustup `llvm-tools` component (rust-toolchain.toml lists it, but
 * CI agents pin via `RUSTUP_TOOLCHAIN` which bypasses that file's component
 * list), so install it on demand.
 */
function ensureLlvmTools(llvmBin: string): void {
  const needed = ["llvm-link", "opt", "llvm-as", "llvm-dis"];
  const missing = () => needed.filter(t => !existsSync(join(llvmBin, t)));
  if (missing().length === 0) return;

  // `<...>/toolchains/<name>/lib/rustlib/<triple>/bin` → `<name>`.
  const toolchain = /[\\/]toolchains[\\/]([^\\/]+)[\\/]/.exec(llvmBin)?.[1];
  const args = ["component", "add", "llvm-tools"];
  if (toolchain !== undefined) args.push("--toolchain", toolchain);
  console.log(`rust-lto-fix: ${missing().join(", ")} not found in ${llvmBin}, running rustup ${args.join(" ")}`);
  const res = spawnSync("rustup", args, { stdio: "inherit" });
  assert(
    res.error === undefined && res.status === 0 && missing().length === 0,
    `missing ${missing().join(", ")} in ${llvmBin}`,
    {
      hint: `Install rustc's LLVM tools: rustup component add llvm-tools${toolchain !== undefined ? ` --toolchain ${toolchain}` : ""}`,
    },
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  assert(
    argv[0] !== undefined && argv[1] !== undefined && argv[2] !== undefined && argv[3] !== undefined,
    "usage: rust-lto-fix-cli.ts <libbun_rust.a> <out.o> <llvm-bin-dir> <ar>",
  );
  // Ninja passes buildDir-relative $in/$out and runs us with cwd=buildDir,
  // but the archive is extracted with cwd set to the scratch dir below —
  // make them absolute first. The tool paths are already absolute.
  const [rustLib, outObj, llvmBin, ar] = [resolve(argv[0]), resolve(argv[1]), argv[2], argv[3]];
  assert(existsSync(rustLib), `${rustLib} does not exist`);
  ensureLlvmTools(llvmBin);

  // Scratch space next to the output; recreated from scratch every run.
  const tmp = `${outObj}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  try {
    // Extract the archive and pick out the bitcode member(s). With
    // `lto = "fat"` there is exactly one (the merged module); the rest are
    // native objects (compiler_builtins) that stay in the archive.
    run(ar, ["x", rustLib], tmp);
    const bitcode = readdirSync(tmp)
      .filter(f => isBitcode(join(tmp, f)))
      .map(f => join(tmp, f));
    assert(bitcode.length > 0, `no LLVM bitcode members found in ${rustLib}`, {
      hint:
        "The ELF cross-language LTO build expects cargo to emit fat bitcode " +
        "(-Clinker-plugin-lto with CARGO_PROFILE_RELEASE_LTO=fat — see emitRust() in rust.ts).",
    });

    // The `ThinLTO=0` module flag is the bitcode writer's "this is a regular
    // LTO module" marker — without it `--module-summary` writes a ThinLTO
    // summary block and lld would send the module to a ThinLTO backend.
    // Carry the module's target data layout on the stub too: without it the
    // stub's empty layout mismatches the real module and llvm-link prints a
    // "Linking two modules of different data layouts" warning on every link.
    // llvm-dis streams the .ll header first, so a bounded read suffices.
    const dis = spawnSync(join(llvmBin, "llvm-dis"), ["-o", "-", bitcode[0]], {
      encoding: "utf8",
      maxBuffer: 256 * 1024,
    });
    const dataLayout = /^target datalayout = "[^"]*"/m.exec(dis.stdout || "")?.[0];
    const stubLl = join(tmp, "regular-lto-flag-stub.ll");
    const stubBc = join(tmp, "regular-lto-flag-stub.bc");
    writeFileSync(
      stubLl,
      `${dataLayout ? `${dataLayout}\n` : ""}!llvm.module.flags = !{!0}\n!0 = !{i32 1, !"ThinLTO", i32 0}\n`,
    );
    run(join(llvmBin, "llvm-as"), [stubLl, "-o", stubBc]);

    const merged = join(tmp, "merged.bc");
    // The stub goes FIRST: llvm-link uses the first module as the link
    // destination, and IRMover silently inherits the data layout / target
    // triple when the destination has none. With the stub last it is a
    // *source* module whose empty layout differs from the destination's,
    // and every build-bun job warns "Linking two modules of different data
    // layouts". Same merged output either way (verified: the module flag and
    // the real layout both survive).
    run(join(llvmBin, "llvm-link"), [stubBc, ...bitcode, "-o", merged]);
    run(join(llvmBin, "opt"), ["--module-summary", merged, "-o", outObj]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Imported by rust.ts for `rustLtoFixCliPath`; only act as a CLI when ninja
// invokes this file directly.
if (process.argv[1] === import.meta.filename) {
  main();
}
