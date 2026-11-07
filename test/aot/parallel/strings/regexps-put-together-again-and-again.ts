// A function puts the text of a regular expression together each time it runs, out of a piece that the build cannot know. The program asks for the same forty texts over and over,
// short ones and ones of several thousand characters, with collections in between. Each text is parsed once: the running program keeps what it has parsed.
// COUNTER: RegExpsCreatedWithoutRecord = 40
// COUNTER: RegExpPatternsParsed <= 80
// COUNTER: RegExpsCompiledToBytecode = 40
declare const process: { argv: string[] } | undefined;
declare const Bun: { gc(force: boolean): void } | undefined;
declare const console: { log(...values: unknown[]): void };
const given: string = typeof process === "object" ? process.argv.slice(2).join("") : String(Date.now()).slice(0, 0);
function escape(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function wordOf(name: string): RegExp { return new RegExp("\\b" + escape(name) + given + "\\b", "g"); }
function anyOf(names: string[], from: number): RegExp {
  const parts: string[] = [];
  for (let i = 0; i < 400; i++) parts.push(escape(names[(from + i) % names.length]) + (from + i));
  return new RegExp("^(?:" + parts.join("|") + given + ")$");
}
const collect: () => void = typeof Bun === "object" ? () => Bun.gc(true) : (globalThis as any).gc;
const names = ["alpha", "beta.gamma", "delta+", "(epsilon)", "zeta|eta", "theta?", "iota*", "kappa^", "lambda$", "mu[nu]", "xi{2}", "omicron\\pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega"];
const text = names.join(" ") + " " + names.join("-");
let found = 0;
for (let round = 0; round < 30; round++) {
  for (const name of names) found += (text.match(wordOf(name)) ?? []).length;
  for (let from = 0; from < 20; from++) found += anyOf(names, from).test(names[from] + from) ? 1 : 0;
  if (round % 3 === 0) collect();
}
console.log(found);
const first = wordOf("rho");
const second = wordOf("rho");
first.lastIndex = 3;
console.log(first === second, first.lastIndex, second.lastIndex, first.source === second.source, String(second));
export {};
