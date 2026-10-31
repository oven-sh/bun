// A number that is printed otherwise than it is written, in the test or in the arm that a constant condition drops, is no part of what an error quotes.
const F = false;
const b: any = F ? 0x10 : null;
function one() {
  return b.x;
}
const c: any = 0x1 ? null : 2;
function two() {
  return c.x;
}
const d: any = false ? 1_000 : undefined;
function three() {
  return d.y;
}
const e: any = true ? null : 0b11;
const four = () => e.z;
const f: any = false && 0x20;
function five() {
  return f.a.b;
}
for (const thrower of [one, two, three, four, five]) {
  try {
    thrower();
  } catch (error) {
    console.log((error as Error).message);
  }
}
