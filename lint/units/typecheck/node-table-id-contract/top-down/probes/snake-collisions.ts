// Lists the Go function and method names of the ported packages that collide after the snake_case rule.
// usage: bun snake-collisions.ts > ../data/snake-collisions.txt
import { readdirSync, readFileSync } from "node:fs";
const R = "/workspace/ref/typescript-go/internal";
const PKGS = ["ast", "binder", "checker", "core", "evaluator", "jsnum", "scanner", "diagnostics", "debug", "stringutil", "collections", "tspath", "compiler", "parser", "module", "tsoptions", "printer", "nodebuilder", "binder"];
// The rule under test: JSDoc, JSX and a run of capitals are one word; a capital after a lower-case letter or digit starts a word;
// the last capital of a run starts a word when a lower-case letter follows.
export function snake(name: string): string {
  let s = name.replace(/JSDoc/g, "Jsdoc").replace(/JSX/g, "Jsx");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const isUp = c >= "A" && c <= "Z";
    if (isUp && i > 0) {
      const p = s[i - 1];
      const n = s[i + 1];
      const pLowOrDigit = (p >= "a" && p <= "z") || (p >= "0" && p <= "9");
      const pUp = p >= "A" && p <= "Z";
      const nLow = n !== undefined && n >= "a" && n <= "z";
      if (pLowOrDigit || (pUp && nLow)) out += "_";
    }
    out += c.toLowerCase();
  }
  return out;
}
const seenPkg = new Set<string>();
let total = 0;
let collisions = 0;
for (const pkg of PKGS) {
  if (seenPkg.has(pkg)) continue;
  seenPkg.add(pkg);
  let files: string[];
  try { files = readdirSync(`${R}/${pkg}`).filter(f => f.endsWith(".go") && !f.endsWith("_test.go")); } catch { continue; }
  // namespace -> snake -> Set(go names)
  const spaces = new Map<string, Map<string, Set<string>>>();
  const where = new Map<string, string>();
  for (const f of files) {
    const lines = readFileSync(`${R}/${pkg}/${f}`, "utf8").split("\n");
    lines.forEach((line, i) => {
      let m = /^func \((?:\w+ )?\*?(\w+)(?:\[[^\]]*\])?\) (\w+)[\[(]/.exec(line);
      let ns: string, name: string;
      if (m) { ns = m[1]; name = m[2]; }
      else {
        m = /^func (\w+)[\[(]/.exec(line);
        if (!m) return;
        ns = "<package>"; name = m[1];
      }
      total++;
      const sn = snake(name);
      let space = spaces.get(ns);
      if (!space) spaces.set(ns, (space = new Map()));
      let set = space.get(sn);
      if (!set) space.set(sn, (set = new Set()));
      set.add(name);
      where.set(`${ns}.${name}`, `${f}:${i + 1}`);
    });
  }
  for (const [ns, space] of spaces) {
    for (const [sn, set] of space) {
      if (set.size > 1) {
        collisions++;
        console.log(`${pkg}\t${ns}\t${sn}\t${[...set].map(n => `${n}@${where.get(`${ns}.${n}`)}`).join("\t")}`);
      }
    }
  }
}
console.error(`functions and methods ${total}; colliding snake names ${collisions}`);
