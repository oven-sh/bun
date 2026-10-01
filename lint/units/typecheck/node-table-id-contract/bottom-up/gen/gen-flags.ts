// Ports the flag sets of internal/ast (Go const blocks) into define_flags! blocks.
import { readFileSync } from "node:fs";
import { GENERATED, upperSnake } from "./names.ts";

const REF = "/workspace/ref/typescript-go/internal/ast/";
const SETS: [file: string, goType: string, repr: string][] = [
  ["nodeflags.go", "NodeFlags", "u32"],
  ["modifierflags.go", "ModifierFlags", "u32"],
  ["tokenflags.go", "TokenFlags", "i32"],
  ["symbolflags.go", "SymbolFlags", "u32"],
  ["checkflags.go", "CheckFlags", "u32"],
  ["flow.go", "FlowFlags", "u32"],
  ["functionflags.go", "FunctionFlags", "u32"],
];

export function generateFlags(): { text: string; counts: Record<string, number> } {
  const out: string[] = [GENERATED("gen/gen-flags.ts", "internal/ast/*flags.go and flow.go"), "use crate::tscore::flags::define_flags;", ""];
  const counts: Record<string, number> = {};
  for (const [file, goType, repr] of SETS) {
    const lines = readFileSync(REF + file, "utf8").split("\n");
    const rows: string[] = [];
    for (const line of lines) {
      const m = new RegExp(`^\\t(${goType}\\w+)\\s+(?:${goType}\\s+)?=\\s*([^/]+?)\\s*(?://.*)?$`).exec(line);
      if (!m) continue;
      const name = m[1].slice(goType.length);
      if (name === "None") continue;
      // Go gives a shift a higher precedence than `-`, Rust a lower one.
      const expr = (/^\d+\s*<<\s*\d+$/.test(m[2]) ? m[2] : m[2].replace(/(\d+)\s*<<\s*(\d+)/g, "($1 << $2)"))
        .replace(new RegExp(`\\b${goType}(\\w+)`, "g"), (_, n) => (n === "None" ? "0" : `Self::${upperSnake(n)}.0`))
        .replace(/&\s*\^/g, "& !")
        .replace(/^\^/, "!");
      rows.push(`    ${upperSnake(name)} = ${expr},`);
    }
    counts[goType] = rows.length;
    out.push(`define_flags!(${goType}: ${repr} {`, ...rows, "});", "");
  }
  return { text: out.join("\n"), counts };
}
