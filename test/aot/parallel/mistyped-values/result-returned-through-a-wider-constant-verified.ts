// Flags: --aot-check=verify-each-pass
// The callee returns a value outside its written result type. The caller returns that result through a constant of a wider type,
// so the tail call carries a test and, behind it, a cast that rests on the test.
function lies(given: bigint): number[] {
  try {
    for (let turn = 0; turn < 3; turn++) {}
  } catch (error) {}
  return given as any;
}
function throughTuple(given: unknown): unknown {
  const held: [number, string] = lies(given as any) as unknown as [number, string];
  return held as any;
}
function throughList(given: unknown): (number | string)[] {
  const held: (number | string)[] = lies(given as any);
  return held;
}
const object = {};
console.log(throughTuple(object) === object);
console.log(throughList(object) === (object as unknown));
console.log(throughList(object).length, throughList([1, 2]).length, typeof throughList("text"));
