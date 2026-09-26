// What a program of C prints, when everything it prints is known to the compiler: the program is
// translated for a target that cannot run here, and the calls of printf are read from the result.
//
// darwin_layout.c is such a program: it prints sizes, offsets and the values of constants. clang puts
// those numbers into the calls when it translates, at every level of optimization, and writes them
// down in the intermediate language of LLVM (-emit-llvm). darwin-headers.ts uses this to ask the
// headers of macOS, and test/mac-tools-on-linux.ts to stand for the compiler of a Mac.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);

/** The SDK of macOS that tools/macos-sdk.ts makes, made if it is not there. */
export function sdkOfMacos(path: string): string {
  const sdk = resolve(path);
  if (!existsSync(join(sdk, "SDK.txt"))) {
    const made = Bun.spawnSync(["bun", join(here, "../tools/macos-sdk.ts"), "--out", sdk], { stdout: "inherit", stderr: "inherit" });
    if (made.exitCode !== 0) throw new Error("tools/macos-sdk.ts did not make the SDK");
  }
  return sdk;
}

/** The target of clang for a processor, as the image names it. */
export const targetOfMacos = (arch: string) => `${arch === "aarch64" ? "arm64" : "x86_64"}-apple-macos11.0`;

/** The text of a string constant of the intermediate language: `\22` is the byte 0x22. */
function decode(text: string): string {
  return text.replace(/\\([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\0$/, "");
}

/** What the calls of printf print, in their order. */
function printed(ir: string): string[] {
  const strings = new Map<string, string>();
  for (const match of ir.matchAll(/^(@[\w.]+) = private unnamed_addr constant \[\d+ x i8\] c"((?:[^"\\]|\\[0-9A-Fa-f]{2})*)"/gm)) strings.set(match[1], decode(match[2]));
  const out: string[] = [];
  for (const match of ir.matchAll(/call i32 \(ptr, \.\.\.\) @printf\(ptr noundef (@[\w.]+)(?:, ([^)]*))?\)/g)) {
    const format = strings.get(match[1]);
    if (format === undefined) throw new Error("a call of printf with a format that is no constant");
    const conversions = format.match(/%(zu|lld|d|ld|lu|llu|u)/g) ?? [];
    if (conversions.length === 0) {
      out.push(format);
      continue;
    }
    if (conversions.length !== 1) throw new Error(`${format.trim()} has ${conversions.length} conversions`);
    const value = /^i(?:32|64) noundef (-?\d+)$/.exec(match[2] ?? "");
    // Not a number that the compiler knows: the macro names a variable or calls a function.
    out.push(format.replace(conversions[0], () => (value ? value[1] : JSON.stringify("not a constant for the compiler"))));
  }
  return out.join("").split("\n").filter(Boolean);
}

export type Evaluated = { ok: boolean; lines: string[]; messages: string };

/** Translates `source` for `target` with the headers of `sdk` and the flags, and reads what it prints. */
export function evaluate(options: { llvm: string; sdk: string; target: string; source: string; flags: string[] }): Evaluated {
  const result = Bun.spawnSync([`${options.llvm}/clang`, `--target=${options.target}`, "-isysroot", options.sdk, ...options.flags, "-S", "-emit-llvm", "-O0", "-o", "-", options.source], { stdout: "pipe", stderr: "pipe" });
  const messages = result.stderr.toString();
  if (result.exitCode !== 0) return { ok: false, lines: [], messages };
  return { ok: true, lines: printed(result.stdout.toString()), messages };
}
