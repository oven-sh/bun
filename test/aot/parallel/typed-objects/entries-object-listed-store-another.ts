// A function makes an object of a declared type, stores a number where the type says a string, reads the other field and lists the entries. The host holds the function too.
// Flags: --aot-validate
const said: unknown[] = [];
function say(...seen: unknown[]): void { for (let at = 0; at < seen.length; at++) said.push(seen[at]); }
type Made = { seen: number; quiet: string };
function makeOne(value: number): Made { return { seen: value, quiet: "q" + value }; }
function run(seed: number): void {
  let sum = seed;
  {
    const now: number = seed;
    const it = makeOne(now);
    (it as any).quiet = now + 50;
    sum += it.seen;
    say(Object.entries(it).map(String).join());
  }
  say(sum);
}
const all = new Set<string>();
for (let round = 0; round < 300; round++) {
  try { run(round % 3); } catch (error) { say("threw"); }
  all.add(said.join());
  said.length = 0;
}
console.log([...all].join(" | "));
(process as any).on("never emitted", run);
