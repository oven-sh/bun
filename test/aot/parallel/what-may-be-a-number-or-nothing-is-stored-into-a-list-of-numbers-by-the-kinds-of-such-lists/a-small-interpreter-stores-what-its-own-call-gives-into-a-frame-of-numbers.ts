// the frame is a literal of whole numbers; what is stored into it is what the function's own call gives: whole numbers, then a fraction, NaN, minus zero, and places behind the end
type Tree =
  | { op: "num"; value: number }
  | { op: "get"; at: number }
  | { op: "set"; at: number; of: Tree }
  | { op: "add"; left: Tree; right: Tree };
function walk(tree: Tree, frame: number[]): number {
  switch (tree.op) {
    case "num": return tree.value;
    case "get": return frame[tree.at]!;
    case "set": return (frame[tree.at] = walk(tree.of, frame));
    case "add": return walk(tree.left, frame) + walk(tree.right, frame);
  }
}
const num = (value: number): Tree => ({ op: "num", value });
const set = (at: number, of: Tree): Tree => ({ op: "set", at, of });
const steps: Tree[] = [
  set(1, num(3)), set(2, { op: "add", left: { op: "get", at: 1 }, right: { op: "get", at: 0 } }), set(0, set(1, num(2147483647))),
  set(1, { op: "add", left: { op: "get", at: 1 }, right: num(1) }), set(2, num(0.5)), set(0, num(NaN)), set(1, num(-0)), set(3, num(9)), set(7, num(1)), set(-1, num(4)), set(1.5, num(5)),
];
const said: string[] = [];
for (let round = 0; round < 40; round++) {
  const frame = [round, 0, 0];
  said.length = 0;
  for (const step of steps) said.push(String(walk(step, frame)), JSON.stringify(frame), String(Object.is(frame[1], -0)), String(frame.length));
  said.push(Object.keys(frame).join());
}
console.log(said.join("\n"));
