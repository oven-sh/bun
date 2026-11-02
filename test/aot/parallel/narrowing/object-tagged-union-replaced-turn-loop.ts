// A loop carries an object of a union that a tag tells apart. One turn in many puts an object of the other member in its place. Every turn reads the field of the member that the tag names,
// and counts in a variable of the module.
// Flags: --aot-check=verify-each-pass
let flips = 0;
function other() {
  return flips++ & 1 ? new Float64Array(new BigUint64Array([0xfffe000000000001n]).buffer)[0] : -3;
}
const first = () => -3,
  second = () => new Float64Array(new BigUint64Array([0xfffe000000000001n]).buffer)[0];
type V = ReturnType<typeof first> | ReturnType<typeof second>;

function differsOneAndTwo(v: V) {
  const w = other();
  return v != w;
}
function byOneAndTwo(at: number) {
  let box: { kind: 1; other: V } | { kind: 2; held: V } = { kind: 1, other: -3 },
    out;
  for (let i = 0; i < 40; i++) {
    if (i === at) box = { kind: 2, held: new Float64Array(new BigUint64Array([0xfffe000000000001n]).buffer)[0] };
    out = differsOneAndTwo(box.kind === 2 ? box.held : box.other);
  }
  return out;
}
function attemptOneAndTwo(at: number) {
  return String(byOneAndTwo(at));
}
{
  const answers: string[] = [];
  for (let n = 0; n < 6; n++) answers.push(attemptOneAndTwo(n % 2 ? 27 : 1000));
  console.log("OneAndTwo", answers.join(" "));
}

function differsTheOtherTag(v: V) {
  const w = other();
  return v != w;
}
function byTheOtherTag(at: number) {
  let box: { kind: 1; other: V } | { kind: 2; held: V } = { kind: 1, other: -3 },
    out;
  for (let i = 0; i < 40; i++) {
    if (i === at) box = { kind: 2, held: new Float64Array(new BigUint64Array([0xfffe000000000001n]).buffer)[0] };
    out = differsTheOtherTag(box.kind !== 2 ? box.other : box.held);
  }
  return out;
}
function attemptTheOtherTag(at: number) {
  return String(byTheOtherTag(at));
}
{
  const answers: string[] = [];
  for (let n = 0; n < 6; n++) answers.push(attemptTheOtherTag(n % 2 ? 27 : 1000));
  console.log("TheOtherTag", answers.join(" "));
}

function differsInAWhileLoop(v: V) {
  const w = other();
  return v != w;
}
function byInAWhileLoop(at: number) {
  let box: { kind: 1; other: V } | { kind: 2; held: V } = { kind: 1, other: -3 },
    out;
  let i = 0;
  while (i < 40) {
    if (i++ === at) box = { kind: 2, held: new Float64Array(new BigUint64Array([0xfffe000000000001n]).buffer)[0] };
    out = differsInAWhileLoop(box.kind === 2 ? box.held : box.other);
  }
  return out;
}
function attemptInAWhileLoop(at: number) {
  return String(byInAWhileLoop(at));
}
{
  const answers: string[] = [];
  for (let n = 0; n < 6; n++) answers.push(attemptInAWhileLoop(n % 2 ? 27 : 1000));
  console.log("InAWhileLoop", answers.join(" "));
}
