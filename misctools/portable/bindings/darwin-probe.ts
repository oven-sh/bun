// What the Rust compiler says about the structures of macOS, without a Mac: the layout that it gives
// the definitions of the `libc` crate when it compiles them for macOS.
//
//   bun darwin-probe.ts <x86_64|aarch64> [--out <facts.jsonl>] [--compare <image.jsonl>]
//
// bun_darwin_sys has the structures of macOS written out with the integer types they stand for, and
// the image compiles that for Linux. A build for macOS compiles the `libc` crate itself. Both have to
// lay a structure out the same way. This tool writes a crate that keeps, in one variable for each
// fact, the size and the alignment of every type of darwin.json and the offset and the size of every
// field, lets rustc compile it for <arch>-apple-darwin into assembly (nothing is linked, so it needs no
// SDK), and reads the numbers from there. The output has the lines of `bun_fs_slice.img --layout-darwin`.
//
// The values of the constants are not read this way: darwin.ts has them from the same compiler already.
// Only a Mac can say whether the headers of macOS agree with the `libc` crate (darwin_layout.c).
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { libcVersion } from "./libc-facts.ts";

const here = dirname(import.meta.path);
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const argv = process.argv.slice(2);
const arch = argv[0];
if (arch !== "x86_64" && arch !== "aarch64") throw new Error("usage: bun darwin-probe.ts <x86_64|aarch64> [--out file] [--compare image.jsonl]");
const option = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const target = `${arch}-apple-darwin`;

type Fact = { fact: string; of: string; expression: string };
const wanted: Fact[] = [];
// The facts, in the order and with the names of the image: its own output says which they are.
const image = Bun.spawnSync(["bun", join(here, "darwin.ts"), "--check"], { env: { ...process.env, WORK: work }, stdout: "pipe", stderr: "pipe" });
if (image.exitCode !== 0) throw new Error("the files of darwin.ts are not up to date");
const program = readFileSync(join(here, "../slice/src/darwin_layout_generated.rs"), "utf8");
let type = "";
let union = false;
for (const line of program.split("\n")) {
  const start = /^\s*type T = types::(\w+);/.exec(line);
  if (start) {
    type = start[1];
    union = false;
    continue;
  }
  const fact = /\\"fact\\":\\"([^\\]+)\\",\\"of\\":\\"([^\\]+)\\"/.exec(line);
  if (!fact || fact[1] === "constant") continue;
  const field = fact[2].includes(".") ? fact[2].split(".")[1] : "";
  const name = /^(type|ref|box|loop|move|in)$/.test(field) ? `r#${field}` : field;
  if (/unsafe \{ &value\./.test(line)) union = true;
  const expression =
    fact[1] === "size" ? `size_of::<libc::${type}>()`
    : fact[1] === "align" ? `align_of::<libc::${type}>()`
    : fact[1] === "offset" ? `offset_of!(libc::${type}, ${name})`
    : `field_size!(libc::${type}, ${name}${union ? ", union" : ""})`;
  wanted.push({ fact: fact[1], of: fact[2], expression });
}

const project = join(work, "darwin-probe");
mkdirSync(join(project, "src"), { recursive: true });
writeFileSync(join(project, "Cargo.toml"), `[workspace]\n\n[package]\nname = "darwin-probe"\nversion = "0.0.0"\nedition = "2024"\n\n[lib]\ncrate-type = ["rlib"]\n\n[dependencies]\nlibc = "=${libcVersion()}"\n`);
writeFileSync(
  join(project, "src/lib.rs"),
  `#![no_std]
#![allow(deprecated, non_upper_case_globals)]
use core::mem::{align_of, offset_of, size_of};

const fn size_of_pointee<T>(_: *const T) -> usize {
    size_of::<T>()
}
macro_rules! field_size {
    ($type:ty, $field:ident) => {{
        let value = core::mem::MaybeUninit::<$type>::uninit();
        // SAFETY: the address of a field of memory that is there; nothing is read.
        size_of_pointee(unsafe { &raw const (*value.as_ptr()).$field })
    }};
    ($type:ty, $field:ident, union) => {
        field_size!($type, $field)
    };
}
${wanted.map((fact, index) => `#[unsafe(no_mangle)]\n#[used]\npub static BUN_FACT_${index}: u64 = ${fact.expression} as u64;`).join("\n")}
`,
);
const built = Bun.spawnSync(["cargo", "rustc", "--offline", "--release", "--target", target, "--", "--emit=asm", "-Ccodegen-units=1"], {
  cwd: project,
  env: { ...process.env, CARGO_TARGET_DIR: join(project, "target"), CARGO_BUILD_JOBS: "8" },
  stdout: "pipe",
  stderr: "pipe",
});
if (built.exitCode !== 0) throw new Error(built.stderr.toString().split("\n").slice(-30).join("\n"));
const found: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/^darwin_probe-.*\.s$/.test(name)) found.push(path);
  }
};
walk(join(project, "target", target, "release"));
found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
if (!found.length) throw new Error("rustc wrote no assembly");
const assembly = readFileSync(found[0], "utf8").split("\n");
const values = new Map<number, string>();
for (let i = 0; i < assembly.length; i++) {
  // A zero that has no bytes in the file.
  const zero = /^\s*\.(?:zerofill\s+\w+,\w+,|comm\s+|lcomm\s+)_BUN_FACT_(\d+),8\b/.exec(assembly[i]);
  if (zero) values.set(Number(zero[1]), "0");
  const label = /^_BUN_FACT_(\d+):$/.exec(assembly[i]);
  if (!label) continue;
  const next = assembly[i + 1] ?? "";
  const value = /^\s*\.quad\s+(\d+)/.exec(next);
  // The assembler also writes the 8 bytes of a number as a string: .asciz "\220\000\000\000\000\000\000"
  const string = /^\s*\.(asciz|ascii)\s+"(.*)"\s*$/.exec(next);
  if (value) values.set(Number(label[1]), value[1]);
  else if (/^\s*\.space\s+8\b/.test(next)) values.set(Number(label[1]), "0");
  else if (string) {
    const bytes: number[] = [];
    const escapes: Record<string, number> = { n: 10, t: 9, r: 13, b: 8, f: 12, "\\": 92, '"': 34 };
    for (let k = 0; k < string[2].length; k++) {
      const c = string[2][k];
      if (c !== "\\") bytes.push(c.charCodeAt(0));
      else if (/[0-7]/.test(string[2][k + 1])) {
        const octal = /^[0-7]{1,3}/.exec(string[2].slice(k + 1))![0];
        bytes.push(parseInt(octal, 8));
        k += octal.length;
      } else bytes.push(escapes[string[2][++k]] ?? string[2].charCodeAt(k));
    }
    if (string[1] === "asciz") bytes.push(0);
    if (bytes.length !== 8) throw new Error(`${found[0]}:${i + 2}: ${bytes.length} bytes for BUN_FACT_${label[1]}`);
    values.set(Number(label[1]), String(bytes.reduceRight((sum, byte) => sum * 256n + BigInt(byte), 0n)));
  } else throw new Error(`${found[0]}:${i + 2}: expected the number of BUN_FACT_${label[1]}, found ${next}`);
}
if (values.size !== wanted.length) throw new Error(`${values.size} numbers in the assembly, ${wanted.length} facts`);
const lines = wanted.map((fact, index) => `{"fact":"${fact.fact}","of":"${fact.of}","value":${values.get(index)}}`);
const out = option("--out") ?? join(work, `out/darwin-probe-${arch}.jsonl`);
writeFileSync(out, lines.join("\n") + "\n");
console.log(`${out}: ${lines.length} facts of the libc crate ${libcVersion()} for ${target}`);
const compare = option("--compare");
if (compare) {
  const ours = new Map(readFileSync(compare, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).map(fact => [`${fact.fact} ${fact.of}`, fact.value]));
  let same = 0;
  let different = 0;
  for (const [index, fact] of wanted.entries()) {
    const theirs = Number(values.get(index));
    const mine = ours.get(`${fact.fact} ${fact.of}`);
    if (mine === theirs) same++;
    else {
      different++;
      console.log(`DIFFERENT ${fact.fact} ${fact.of}: ${mine} in the image, ${theirs} in the libc crate for ${target}`);
    }
  }
  console.log(`${same} facts are the same, ${different} differ`);
  process.exit(different ? 1 : 0);
}
