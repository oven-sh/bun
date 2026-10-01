import { readFileSync } from "node:fs";
const names = readFileSync("/tmp/conf-it-1b/all-names.txt", "utf8").split("\n").filter(Boolean);
const caseBaseName = (n: string) => { const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(n); return m === null ? n : m[1] + m[3]; };
const facts = names.map(name => ({ name, directory: "compiler", casePath: "compiler/" + caseBaseName(name) }));
type Fact = (typeof facts)[number];
function matcher(selector: string): (fact: Fact) => boolean {
  if (selector.includes("*")) { const parts = selector.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); const pattern = new RegExp(`^${parts.join(".*")}$`, "s"); return fact => pattern.test(fact.name); }
  if (selector.endsWith("/")) return fact => `${fact.directory}/`.startsWith(selector);
  if (selector.includes("/")) return fact => fact.casePath === selector;
  return fact => fact.name === selector || fact.casePath.endsWith(`/${selector}`);
}
for (const count of [100, 1000, 5000, names.length]) {
  const selectors = names.slice(0, count);
  const t = performance.now();
  const matchers = selectors.map(selector => ({ selector, matches: matcher(selector), taken: 0 }));
  let taken = 0;
  for (const fact of facts) { let selected = false; for (const m of matchers) { if (!m.matches(fact)) continue; m.taken++; selected = true; } if (selected) taken++; }
  console.log(`old select: ${count} selectors x ${facts.length} instances: ${Math.round(performance.now() - t)} ms, taken ${taken}`);
}
