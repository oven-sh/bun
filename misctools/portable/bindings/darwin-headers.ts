// What the headers of macOS say about the definitions of bun_darwin_sys, on a machine that is no Mac.
//
//   bun darwin-headers.ts <x86_64|aarch64> [--sdk <directory>] [--out <facts.jsonl>] [--compare <image.jsonl>]
//                                           [--header <facts.h>]
//
// darwin_layout.c is the program that a Mac compiles and runs (run-on-mac.sh): it prints the size of
// every structure, the offset of every field and the value of every constant. It cannot run here. But
// everything it prints is known to the compiler: clang puts the numbers into the calls of printf when
// it translates the program, whatever the level of optimization. So each part of the program is
// compiled for macOS, with the headers of macOS (tools/macos-sdk.ts), into the intermediate language of
// LLVM, and the calls of printf are read from there: the format and the number. The output has the
// lines that the program prints on a Mac whose headers are the ones of that SDK.
//
// A part that does not compile is treated as run-on-mac.sh treats it: a field that the headers do not
// have is left out (-DSKIP_<type>_<field>, from the message of the compiler) and the part is compiled
// again. What was left out, and the parts that do not compile at all, are printed.
//
// --header <facts.h>: the same facts as macros of C, for a program that is no program of macOS and has
// to know macOS (test/libsystem_on_linux.h): D_<constant>, D_SIZE_<type>, D_ALIGN_<type>,
// D_OFFSET_<type>__<field>, D_FIELD_SIZE_<type>__<field>.
//
// --compare <image.jsonl>: what `bun_fs_slice.img --layout-darwin` printed. Every fact that differs is
// printed with both values, as compare-darwin.ts does, and the exit code is 1 if there is one, if a
// part does not compile, or if a field or a constant of the image is not in the headers. A name that
// the headers cannot have is written down, with the reason, in darwin-not-in-the-headers.json next to
// this file ({"not_in_the_headers": {"<type>" | "<type>.<field>" | "<constant>": "<why>"}}); there is
// no such name today, and no such file.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const argv = process.argv.slice(2);
const arch = argv[0];
if (arch !== "x86_64" && arch !== "aarch64") throw new Error("usage: bun darwin-headers.ts <x86_64|aarch64> [--sdk directory] [--out file] [--compare image.jsonl]");
const option = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const sdk = resolve(option("--sdk") ?? join(work, "ref/macos-sdk"));
if (!existsSync(join(sdk, "SDK.txt"))) {
  const made = Bun.spawnSync(["bun", join(here, "../tools/macos-sdk.ts"), "--out", sdk], { stdout: "inherit", stderr: "inherit" });
  if (made.exitCode !== 0) throw new Error("tools/macos-sdk.ts did not make the SDK");
}
const source = join(here, "darwin_layout.c");
const parts: { part: number; what: string }[] = JSON.parse(readFileSync(join(here, "darwin.json"), "utf8")).parts_of_darwin_layout_c;
const target = `${arch === "aarch64" ? "arm64" : "x86_64"}-apple-macos11.0`;

function translate(part: number, skip: string[]): { ok: boolean; text: string; messages: string } {
  const result = Bun.spawnSync([`${llvm}/clang`, `--target=${target}`, "-isysroot", sdk, "-w", ...skip, `-DPART=${part}`, "-S", "-emit-llvm", "-O0", "-o", "-", source], { stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, text: result.stdout.toString(), messages: result.stderr.toString() };
}

/** The text of a string constant of the intermediate language: `\22` is the byte 0x22. */
function decode(text: string): string {
  return text.replace(/\\([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\0$/, "");
}

/** What the calls of printf of `main` print. */
function printed(ir: string, where: string): string[] {
  const strings = new Map<string, string>();
  for (const match of ir.matchAll(/^(@[\w.]+) = private unnamed_addr constant \[\d+ x i8\] c"((?:[^"\\]|\\[0-9A-Fa-f]{2})*)"/gm)) strings.set(match[1], decode(match[2]));
  const lines: string[] = [];
  for (const match of ir.matchAll(/call i32 \(ptr, \.\.\.\) @printf\(ptr noundef (@[\w.]+)(?:, ([^)]*))?\)/g)) {
    const format = strings.get(match[1]);
    if (format === undefined) throw new Error(`${where}: a call of printf with a format that is no constant`);
    const conversions = format.match(/%(zu|lld)/g) ?? [];
    if (conversions.length === 0) {
      lines.push(format);
      continue;
    }
    const value = /^i64 noundef (-?\d+)$/.exec(match[2] ?? "");
    if (conversions.length !== 1) throw new Error(`${where}: ${format.trim()} has ${conversions.length} conversions`);
    // Not a number that the compiler knows: the macro names a variable or calls a function.
    lines.push(value ? format.replace(/%(zu|lld)/, () => value[1]) : format.replace(/%(zu|lld)/, () => JSON.stringify("not a constant for the compiler")));
  }
  return lines.join("").split("\n").filter(Boolean);
}

const facts: string[] = [];
const leftOut: string[] = [];
const doNotCompile: string[] = [];
for (const { part, what } of parts) {
  let attempt = translate(part, []);
  if (!attempt.ok) {
    const type = /^type (\w+)$/.exec(what)?.[1];
    // The messages that run-on-mac.sh reads: "no member named 'x' in 'struct y'".
    const fields = [...new Set([...attempt.messages.matchAll(/error: no member named '(\w+)'/g)].map(match => match[1]))];
    if (type && fields.length) {
      leftOut.push(`${type}: ${fields.join(" ")}`);
      attempt = translate(part, fields.map(field => `-DSKIP_${type}_${field}`));
    }
  }
  if (!attempt.ok) {
    doNotCompile.push(`${what}: ${(/error: .*/.exec(attempt.messages)?.[0] ?? attempt.messages.trim().split("\n")[0]).slice(0, 200)}`);
    continue;
  }
  facts.push(...printed(attempt.text, `part ${part} (${what})`));
}
const out = option("--out");
if (out) writeFileSync(resolve(out), facts.join("\n") + "\n");
const header = option("--header");
if (header) {
  const lines = [
    "/* Written by misctools/portable/bindings/darwin-headers.ts --header. Do not edit.",
    `   What the headers of macOS say for ${target} (${readFileSync(join(sdk, "SDK.txt"), "utf8").trim().split("\n").join(", ")}),`,
    "   about the definitions that misctools/portable/bindings/darwin_layout.c asks for. */",
  ];
  for (const line of facts) {
    const { fact, of, value } = JSON.parse(line) as { fact: string; of: string; value: number | string };
    if (typeof value !== "number") continue;
    const name = fact === "constant" ? `D_${of}` : `D_${fact.toUpperCase().replace(" ", "_")}_${of.replace(".", "__")}`;
    lines.push(`#define ${name} (${value})`);
  }
  writeFileSync(resolve(header), lines.join("\n") + "\n");
}
console.log(`${readFileSync(join(sdk, "SDK.txt"), "utf8").trim().split("\n").join(", ")}, ${target}: ${facts.length} facts from ${parts.length - doNotCompile.length} of ${parts.length} parts`);
for (const line of leftOut) console.log(`fields that the headers do not have   ${line}`);
for (const line of doNotCompile) console.log(`DOES NOT COMPILE   ${line}`);

const imagePath = option("--compare");
let failed = doNotCompile.length > 0;
if (imagePath) {
  type Fact = { fact: string; of: string; value: number | string };
  const read = (lines: string[]) => new Map(lines.map(line => JSON.parse(line) as Fact).map(fact => [`${fact.fact} ${fact.of}`, fact.value]));
  const image = read(readFileSync(resolve(imagePath), "utf8").split("\n").filter(Boolean));
  const headers = read(facts);
  const exceptions = join(here, "darwin-not-in-the-headers.json");
  const known: Record<string, string> = existsSync(exceptions) ? JSON.parse(readFileSync(exceptions, "utf8")).not_in_the_headers : {};
  const used = new Set<string>();
  let same = 0;
  const differences: string[] = [];
  const absent: string[] = [];
  const explained: string[] = [];
  for (const [name, ours] of image) {
    const theirs = headers.get(name);
    if (theirs === ours) {
      same++;
      continue;
    }
    if (typeof theirs === "number") {
      differences.push(`${name}: ${ours} in the image, ${theirs} in the headers`);
      continue;
    }
    const of = name.replace(/^(size|align|offset|field size|constant) /, "");
    const why = known[of] ?? known[of.split(".")[0]];
    if (why !== undefined) {
      used.add(known[of] !== undefined ? of : of.split(".")[0]);
      explained.push(`${name}: ${theirs ?? "not printed"} (${why})`);
    } else absent.push(`${name}: ${theirs ?? "the headers did not print it"}`);
  }
  for (const line of explained) console.log(`not in the headers, and known   ${line}`);
  for (const line of absent) console.log(`NOT IN THE HEADERS   ${line}`);
  for (const line of differences) console.log(`DIFFERENT   ${line}`);
  for (const name of Object.keys(known)) if (!used.has(name)) console.log(`darwin-not-in-the-headers.json names ${name}, which the headers have or the image has not`);
  console.log(`${same} facts are the same, ${differences.length} differ, ${absent.length} are not in the headers, ${explained.length} are not in the headers for a reason that is written down`);
  failed ||= differences.length > 0 || absent.length > 0;
}
process.exit(failed ? 1 : 0);
