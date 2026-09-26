// Compares the machine code of one crate in two builds, function by function.
//
//   bun compare-asm.ts <before.s> <after.s> [--show <part of a function name>]
//
// The two files are what `rustc --emit=asm` writes for the same crate in two trees. A function is the
// lines between its label and the next one. Before two functions are compared, what differs between
// any two builds of the same source is made equal: the hash of a crate and the number of an `impl`
// block in a mangled name, the numbers of local labels, debug and CFI directives. Prints how many functions are the same, and the ones that
// are not, or exist on one side only. Of a function that is not the same it says whether it is the
// same instructions in another order.
import { readFileSync } from "node:fs";

const [beforePath, afterPath, ...rest] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error("usage: bun compare-asm.ts <before.s> <after.s> [--show name]");
const show = rest[0] === "--show" ? rest[1] : undefined;

function functions(path: string) {
  const out = new Map<string, string[]>();
  let current: string[] | undefined;
  // In a mangled name: the hash of a crate, and the number of an `impl` block among the ones of its
  // module, which moves when a block is added in front of it.
  const mangled = (text: string) =>
    text
      .replace(/Cs[0-9A-Za-z]+_(\d)/g, "Cs_$1")
      .replace(/17h[0-9a-f]{16}E/g, "17hE")
      .replace(/(_RNv[MX])s[0-9A-Za-z]*_/g, "$1s_");
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    const label = /^([A-Za-z_$][A-Za-z_0-9$.]*):$/.exec(line);
    // A constant without a name is `anon.<hash of the crate>.<number>` in an object file for Windows.
    if (label && !label[1].startsWith(".L") && !label[1].startsWith("anon.")) {
      current = [];
      out.set(mangled(label[1]), current);
      continue;
    }
    if (/^\s*\.(type|size|globl|hidden|weak|section|text|p2align|file|loc|cfi_|ident|addrsig|cv_|local|comm|data|bss|def|scl|endef|seh_)/.test(line)) {
      if (/^\s*\.(section|text|data|bss)/.test(line)) current = undefined;
      continue;
    }
    if (!current || !line.trim()) continue;
    current.push(mangled(line.trim()));
  }
  // Local labels are numbered over the whole file: inside a function they are named by their order.
  for (const [name, lines] of out) {
    const names = new Map<string, string>();
    const local = /\.L[A-Za-z_0-9$.]+|anon\.[0-9a-f]{32}\.\d+|__unnamed_\d+/g;
    out.set(
      name,
      lines.map(line =>
        line.replace(local, label => {
          if (!names.has(label)) names.set(label, `.L${names.size}`);
          return names.get(label)!;
        }),
      ),
    );
  }
  return out;
}

const before = functions(beforePath);
const after = functions(afterPath);
let same = 0;
const different: { name: string; lines_before: number; lines_after: number; same_instructions_in_another_order: boolean }[] = [];
// Labels are named by their order, so they are left out when only the instructions are counted.
const instructions = (lines: string[]) => lines.filter(line => !/^\.L\d+:$/.test(line)).map(line => line.replace(/\.L\d+/g, ".L")).sort().join("\n");
for (const [name, lines] of before) {
  const other = after.get(name);
  if (!other) continue;
  if (lines.join("\n") === other.join("\n")) same++;
  else different.push({ name, lines_before: lines.length, lines_after: other.length, same_instructions_in_another_order: instructions(lines) === instructions(other) });
}
const onlyBefore = [...before.keys()].filter(name => !after.has(name));
const onlyAfter = [...after.keys()].filter(name => !before.has(name));
if (show) {
  for (const name of [...before.keys()].filter(n => n.includes(show))) {
    const a = before.get(name)!, b = after.get(name) ?? [];
    console.log(`== ${name}: ${a.length} lines before, ${b.length} after, ${a.join("\n") === b.join("\n") ? "the same" : "DIFFERENT"}`);
    if (a.join("\n") !== b.join("\n")) for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) console.log(`   ${i}: ${a[i] ?? ""}   |   ${b[i] ?? ""}`);
  }
}
console.log(JSON.stringify({ functions_in_both: same + different.length, same, different, only_before: onlyBefore, only_after: onlyAfter }, null, 1));
