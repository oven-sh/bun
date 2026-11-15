// A list that Object.keys(), Object.values() or split() has just made is stepped by index without a look. Each deed changes such a list between its making and its loop, so that the loop must see the change.
function ownIterator(o: Record<string, number>) {
  const keys = Object.keys(o);
  (keys as any)[Symbol.iterator] = function* () { yield "mine"; };
  let seen = "";
  for (const k of keys) seen += k + ",";
  return seen;
}
function otherPrototype(o: Record<string, number>) {
  const keys = Object.keys(o);
  Object.setPrototypeOf(keys, { [Symbol.iterator]: function* () { yield "above"; } });
  let seen = "";
  for (const k of keys as any) seen += k + ",";
  return seen;
}
function getterInTheMiddle(text: string) {
  const pieces = text.split(",");
  let hits = 0;
  Object.defineProperty(pieces, 1, { get() { hits++; return "got"; } });
  let seen = "";
  for (const p of pieces) seen += p + ",";
  return seen + hits;
}
function holeAndName(o: Record<string, number>) {
  const values: any = Object.values(o);
  delete values[0];
  values.name = "named";
  values.length = 3;
  let seen = "";
  for (const v of values) seen += v + ",";
  return seen + values.name;
}
function grownInTheLoop(o: Record<string, number>) {
  const keys = Object.keys(o);
  let seen = "";
  for (const k of keys) { seen += k + ","; if (keys.length < 5) keys.push(k + k); }
  return seen;
}
function handedOut(o: Record<string, number>, change: (list: string[]) => void) {
  const keys = Object.keys(o);
  change(keys);
  let seen = "";
  for (const k of keys) seen += k + ",";
  return seen;
}
const record = { x: 1, y: 2 };
for (let round = 0; round < 3; round++) {
  console.log(ownIterator(record), otherPrototype(record), getterInTheMiddle("a,b,c"), holeAndName(record), grownInTheLoop(record));
  console.log(handedOut(record, () => {}), handedOut(record, list => { (list as any)[Symbol.iterator] = function* () { yield "changed"; }; }));
}
