// `n > 0 ? "hex" : "dec"` is held as a word over a yield, while the caller collects, throws into the generator or leaves it. What comes in at the yield is a rope.
// Under: --aot-testing=CheckProofsAtRunTime: the type of a join of written texts
const parts = JSON.parse('["he","x","de","c"]') as string[];
const log: string[] = [];
function* compare(n: number): Generator<string, string, string> {
  const kind = n > 0 ? "hex" : "dec";
  try {
    const text = yield kind;
    const again = yield String(kind === text) + kind.length;
    return kind + again + String(kind === again);
  } catch (error) {
    return "caught " + kind + String(error);
  } finally {
    log.push("left " + kind);
  }
}
const lines: string[] = [];
for (const n of [1, 0]) {
  const steps = compare(n);
  lines.push(steps.next().value);
  Bun.gc(true);
  lines.push(steps.next(parts[0] + parts[1]).value);
  Bun.gc(true);
  lines.push(steps.next(parts[2] + parts[3]).value);
}
const thrown = compare(1);
thrown.next();
lines.push(String(thrown.throw("x").value));
const left = compare(0);
left.next();
lines.push(String(left.return("gone").value));
console.log(lines.join("\n"));
console.log(log.join());
