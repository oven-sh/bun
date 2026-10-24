// The callee makes a copy of an object, with a spread, with Object.assign into a literal, with structuredClone, and returns it under the declared type. In some rounds the source was damaged before:
// a field holds a string, a field is an accessor, a field was deleted. The copy is new, so nobody has tested it, and the caller reads its fields right behind the call under the type that the callee declares.
// The caller also holds the source across the call.
type Pair = { left: number; right: number };

let reads = 0;
function damage(pair: Pair, kind: number): Pair {
  if (kind === 1) (pair as any).left = "text";
  if (kind === 2) Object.defineProperty(pair, "left", { get: () => ++reads * -1, enumerable: true, configurable: true });
  if (kind === 3) delete (pair as any).left;
  if (kind === 4) (pair as any).more = 5;
  return pair;
}

function bySpread(source: Pair): Pair {
  return { ...source };
}
function byAssign(source: Pair): Pair {
  return Object.assign({ left: 0, right: 0 }, source);
}
function byClone(source: Pair): Pair {
  return structuredClone(source);
}

function holder(source: Pair): string {
  const before = source.right;
  const a = bySpread(source);
  const first = a.left + "," + a.right;
  const b = byAssign(source);
  const second = b.left + "," + b.right;
  const c = byClone(source);
  const third = c.left + "," + c.right;
  return before + " " + first + " " + second + " " + third + " " + source.left + "," + source.right + " " + Object.keys(a).join("") + Object.keys(b).join("") + Object.keys(c).join("");
}

for (let round = 0; round < 500; round++) {
  const kind = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(damage({ left: round, right: 1 }, kind));
  if (kind || round === 0) console.log(round + ": " + line);
}
