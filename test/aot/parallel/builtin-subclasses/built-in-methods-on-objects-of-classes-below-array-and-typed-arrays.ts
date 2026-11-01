// Flags: --aot-check=verify-each-stage
// Methods of Array and of a typed array on objects of classes below them: with no argument, in loops, behind empty try blocks, and through a parameter of the built-in class.
class List<T> extends Array<T> {}
class Rows extends Array<number> {}
class Halves extends Float32Array {}
function make(): List<string> {
  const list = new List<string>();
  for (let i = 0; i < 8; i++) list.push();
  for (let i = 0; i < 3; i++) list.push("a" + i);
  return list;
}
function scene(): number {
  const list = make();
  try {
  } catch (error) {}
  try {
  } catch (error) {}
  return list.length;
}
function shifted(): string {
  let out = "";
  for (let round = 0; round < 3; round++) {
    const rows = new Rows();
    for (let i = 0; i < 5; i++) rows.push(i + round);
    out += rows.shift() + "," + rows.unshift(9) + "," + rows.splice(1, 2).length + "," + rows.length + ";";
  }
  return out;
}
function valuesOf(view: Float32Array): number[] {
  const out: number[] = [];
  for (const value of view) out.push(value);
  for (let i = 0; i < view.length; i++) out.push(view[i]!);
  return out;
}
for (let round = 0; round < 3; round++) console.log(scene(), shifted(), valuesOf(new Halves([1.5, 2.25, -3])).join(), valuesOf(new Float32Array([4])).join());
