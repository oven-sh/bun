// The file set that the assembler of the other pass builds (../../bottom-up/overlay/assemble.ts), with the merged set
// of this pass in place of its foundation files: the files of ../runner are copied, and an import of a name that
// this pass keeps in bytestring.ts is routed there. The result has the layout of the repository.
// usage: bun assemble_with_this_set.ts <directory that assemble.ts wrote> <output directory>
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [from, out] = process.argv.slice(2);
const runnerOf = (root: string) => join(root, "test/cli/lint/conformance/runner");
const mine = join(import.meta.dir, "..", "runner");

// The names of bytestring.ts; every other name of the foundation stays where the other pass has it.
const inByteString = new Set([
  "ByteString",
  "RuneError",
  "InvalidUtf8Error",
  "toByteString",
  "fromByteString",
  "utf8Bytes",
  "utf8String",
  "utf8ToByteString",
  "byteStringToUtf8",
  "validString",
  "decodeRune",
  "decodeLastRune",
  "runeCount",
  "trimRightSpace",
  "replaceNonWhitespace",
]);
// The other pass has a second error for a lone surrogate; this pass has one error for both directions.
const renamed: Record<string, string> = { IllFormedStringError: "InvalidUtf8Error" };

rmSync(out, { recursive: true, force: true });
cpSync(from, out, { recursive: true });
const foundation = readdirSync(mine);
for (const f of foundation) cpSync(join(mine, f), join(runnerOf(out), f));

let rerouted = 0;
const touched: string[] = [];
function reroute(path: string): void {
  let text = readFileSync(path, "utf8");
  const before = text;
  text = text.replace(/^import \{([^}]*)\} from "([^"]*)gostrings";$/gm, (_statement, list: string, prefix: string) => {
    const stay: string[] = [];
    const move: string[] = [];
    for (const item of list.split(",").map(s => s.trim()).filter(s => s !== "")) {
      const m = /^(type )?([A-Za-z_$][\w$]*)(?: as ([A-Za-z_$][\w$]*))?$/.exec(item);
      if (m === null) throw new Error(`${path}: cannot read the import of ${item}`);
      const name = renamed[m[2]] ?? m[2];
      const entry = (m[1] ?? "") + name + (m[3] !== undefined ? ` as ${m[3]}` : "");
      (inByteString.has(name) ? move : stay).push(entry);
    }
    if (move.length > 0) rerouted += move.length;
    const lines: string[] = [];
    if (move.length > 0) lines.push(`import { ${move.join(", ")} } from "${prefix}bytestring";`);
    if (stay.length > 0) lines.push(`import { ${stay.join(", ")} } from "${prefix}gostrings";`);
    return lines.join("\n");
  });
  for (const [old, name] of Object.entries(renamed)) text = text.replaceAll(old, name);
  if (text !== before) {
    writeFileSync(path, text);
    touched.push(path.slice(out.length + 1));
  }
}
for (const f of readdirSync(runnerOf(out))) if (f.endsWith(".ts") && !foundation.includes(f)) reroute(join(runnerOf(out), f));
reroute(join(out, "test/cli/lint/conformance/sweep.ts"));
reroute(join(out, "test/cli/lint/conformance.test.ts"));
console.log(`${foundation.length} foundation files of this pass, ${rerouted} imported names routed to bytestring.ts in ${touched.length} files`);
for (const t of touched) console.log("  " + t);
