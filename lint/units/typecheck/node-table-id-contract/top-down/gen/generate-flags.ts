// Ports a Go flags file (type X uintNN; const ( XName X = expr ... )) into a bitflags! block.
// usage: bun generate-flags.ts <go file> <Go type> <bits type> > out.rs
import { readFileSync } from "node:fs";
import { snake } from "./names.ts";
const [file, goType, bits] = process.argv.slice(2);
const src = readFileSync(file, "utf8").split("\n");
const out: string[] = [];
out.push(`// Generated from ${file.replace("/workspace/ref/typescript-go/", "")} (typescript-go 89d5d5b). Do not edit.`);
out.push("bitflags::bitflags! {");
out.push("    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]");
out.push(`    pub struct ${goType}: ${bits} {`);
const constName = (n: string) => snake(n.slice(goType.length)).toUpperCase();
for (const line of src) {
  const m = new RegExp(`^\\t(${goType}\\w+)\\s+(?:${goType}\\s+)?=\\s*([^/]+?)\\s*(?://.*)?$`).exec(line);
  if (!m) continue;
  const name = m[1];
  if (name === goType + "None") continue;
  const expr = m[2]
    .replace(new RegExp(`\\b${goType}(\\w+)`, "g"), (_, n) => `Self::${snake(n).toUpperCase()}.bits()`)
    .replace(/& \^/g, "& !");
  out.push(`        const ${constName(name)} = ${expr};`);
}
out.push("    }");
out.push("}");
console.log(out.join("\n"));
