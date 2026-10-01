// Vectors with diagnostics made by NewExternalDiagnostic, for the identity and prefix rules.
import fs from "node:fs";
let seed = 0x51ed27;
function rnd() { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const ri = n => Math.floor(rnd() * n);
const pick = a => a[ri(a.length)];
const hex = b => (b.length === 0 ? "-" : Buffer.from(b).toString("hex"));
const B = s => Buffer.from(s, "utf8");
const out = [];
out.push(`F ${hex(B("/src/a.ts"))} ${hex(B("const x: number = \"s\";\nlet y = 2;\n"))}`);
out.push(`F ${hex(B("/src/b.vue"))} ${hex(B("<template>\n</template>\n"))}`);
const texts = ["';' expected.", "Type 'string' is not assignable to type 'number'.", "Type_0_is_not_assignable_to_type_1_2322", "Type_0_is_not_assignable_to_type_1_2321", "Type_0_is_not_assignable_to_type_1_2323", "A", "a", "Identifier expected.", "Identifier_expected_1003", "zzz"];
for (let c = 0; c < 60; c++) {
  const lines = [], top = []; let id = 0;
  const n = 2 + ri(14);
  for (let i = 0; i < n; i++) {
    const file = pick([0, 0, 1, -1]);
    const pos = file < 0 ? -1 : pick([0, 6, 7]); const end = file < 0 ? -1 : pos + pick([0, 1]);
    if (rnd() < 0.6) lines.push(`X ${file} ${pos} ${end} ${hex(B(pick(["", "", "vue", "mapper-a", "mapper-b", "TS"])))} ${pick([1, 1, 1, 0, 2, 3])} ${pick([2322, 1003, 0, 1005, -1])} ${hex(B(pick(texts)))}`);
    else { const code = pick([2322, 1003]); lines.push(code === 2322 ? `D ${file} ${pos} ${end} 2322 -1 0 2 s:${hex(B(pick(["string", "a"])))} s:${hex(B("number"))}` : `D ${file} ${pos} ${end} 1003 -1 0 0`); }
    top.push(id++);
    if (rnd() < 0.2) { lines.push(`R ${id - 1} ${ri(id)}`); }
  }
  out.push(`CASE external${c}`, ...lines.filter(l => !l.startsWith("R ") || l.split(" ")[1] !== l.split(" ")[2]), `TOP ${top.join(" ")}`, "END");
}
fs.writeFileSync(process.argv[2] ?? "vectors-external.txt", out.join("\n") + "\n");
const keys = [];
const go = fs.readFileSync("/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go", "utf8");
for (const m of go.matchAll(/^var \w+ = &Message\{code: (-?\d+),/gm)) keys.push(`KEY ${m[1]}`);
fs.writeFileSync(process.argv[3] ?? "vectors-keys.txt", keys.join("\n") + "\n");
console.log("external lines", out.length, "keys", keys.length);
