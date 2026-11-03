// Takes parts, copies and reversed copies of views that are of one of two classes, by name and through .call on receivers of every kind.
// Flags: --aot-check=verify-each-pass
function lengthOfPart(view: any): number {
  const part = Uint8Array.prototype.subarray.call(view, 1);
  return part.length * 100 + part[0] + part.byteOffset;
}
function lengthOfPartOfPart(view: any): number {
  const part = view.subarray(1);
  const again = part.subarray(1);
  return again.length * 100 + again[0] + again.byteOffset;
}
function pick(turn: number): Uint8Array | Float64Array {
  return turn % 2 ? new Uint8Array([1, 2, 3, 4]) : new Float64Array([1.5, 2.5, 3.5]);
}

let sum = 0;
for (let turn = 0; turn < 400; turn++) {
  const view = turn % 2 ? new Uint8Array([1, 2, 3, 4]) : new Float64Array([1.5, 2.5, 3.5]);
  sum += lengthOfPart(view) + lengthOfPartOfPart(view);
}
console.log(sum);

let other = 0;
for (let turn = 0; turn < 400; turn++) {
  const view = pick(turn);
  const part = view.subarray(1);
  other +=
    part.length +
    part[0] +
    part.subarray(1).length +
    view.slice(1)[1] +
    view.toReversed()[0] +
    view.toSorted()[0] +
    view.with(0, 9)[0];
  if (part instanceof Uint8Array) other += part[1];
  else other += part[1] * 2;
}
console.log(other);

const receivers = () => [
  undefined,
  null,
  5,
  "text",
  true,
  { length: 2, 0: "a", 1: "b" },
  [3, 1, 2],
  new Map([[1, 2]]),
  new Uint8Array([7, 8]),
  function named() {},
  new Date(0),
  /a/g,
  new Float32Array([1.5, 2.5]),
];
function row(label: string, run: () => any) {
  let line: string;
  try {
    const result = run();
    line = Object.prototype.toString.call(result) + " " + String(result);
  } catch (error: any) {
    line = "throws " + error.name;
  }
  console.log(label + ": " + line);
}
for (let i = 0; i < 13; i++) {
  row("subarray on " + i, () => Float64Array.prototype.subarray.call(receivers()[i] as any));
  row("subarray on " + i + " with 1", () => Float64Array.prototype.subarray.call(receivers()[i] as any, 1));
  row("slice on " + i, () => Float64Array.prototype.slice.call(receivers()[i] as any, 1, 2));
  row("toReversed on " + i, () => Float64Array.prototype.toReversed.call(receivers()[i] as any));
  row("toLocaleString on " + i, () =>
    (Float64Array.prototype.toLocaleString as () => string).call(receivers()[i] as any),
  );
}
