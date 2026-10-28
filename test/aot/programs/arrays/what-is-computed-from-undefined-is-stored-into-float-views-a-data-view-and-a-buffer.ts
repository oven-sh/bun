// Computes with a value that is undefined when the program runs, stores each result into a float view, a DataView or a Buffer where it is computed, and prints the bytes.
const bytes = new Uint8Array(8),
  number = new Float64Array(bytes.buffer);
const shown = () =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, "0"))
    .reverse()
    .join("")
    .slice(0, 4);
function typed(x: number | undefined, out: string[]) {
  number[0] = (x as any) + 1;
  out.push(shown());
  number[0] = (x as any) * -1;
  out.push(shown());
  number[0] = -1 * (x as any);
  out.push(shown());
  number[0] = (x as any) + (x as any);
  out.push(shown());
  number[0] = -(x as any);
  out.push(shown());
  number[0] = -((x as any) + (x as any));
  out.push(shown());
  number[0] = +(x as any);
  out.push(shown());
}
function optional(out: string[], x?: number) {
  number[0] = x! + 1;
  out.push(shown());
  number[0] = x! * -1;
  out.push(shown());
  number[0] = -x!;
  out.push(shown());
}
function untyped(x: any, out: string[]) {
  number[0] = x + 1;
  out.push(shown());
  number[0] = x * -1;
  out.push(shown());
  number[0] = -x;
  out.push(shown());
}
const late = [undefined, 1.5, undefined][Date.now() > 0 ? 0 : 1];
for (let turn = 0; turn < 3; turn++) {
  const out: string[] = [];
  typed(late, out);
  optional(out);
  optional(out, late);
  untyped(late, out);
  console.log(turn, out.join(" "));
}
const list: (number | undefined)[] = [1.5, undefined, 2.5];
const into = new Float64Array(3);
for (let at = 0; at < list.length; at++) into[at] = (list[at] as any) + 1;
console.log(Array.from(new Uint8Array(into.buffer), byte => byte.toString(16).padStart(2, "0")).join(""));
const from = new Float64Array([1.5, 2.5, 3.5]);
const floats = new Float32Array(2);
const view = new DataView(new ArrayBuffer(16));
const buffer = Buffer.alloc(16);
const hexOf = (held: ArrayBufferView) =>
  Array.from(new Uint8Array(held.buffer, held.byteOffset, held.byteLength), byte =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
function mixed(x: number | undefined, takesRead: boolean) {
  for (let at = 0; at < from.length; at++) into[at] = from[at] + (x as any);
  console.log("a read and undefined", hexOf(into));
  for (let at = 0; at < from.length; at++) into[at] = -((x as any) * from[at]);
  console.log("negated", hexOf(into));
  for (let at = 0; at < from.length; at++) into[at] = from[at] * ((x as any) + 1);
  console.log("by a sum", hexOf(into));
  into[0] = takesRead ? from[0] : (x as any) + 1;
  into[1] = takesRead ? (x as any) + 1 : from[1];
  console.log("either", hexOf(into));
  floats[0] = (x as any) + 1;
  floats[1] = -(x as any);
  console.log("floats", hexOf(floats));
  view.setFloat64(0, (x as any) + 1);
  view.setFloat32(8, -(x as any), true);
  console.log("a DataView", hexOf(view));
  buffer.writeDoubleLE((x as any) + 1, 0);
  buffer.writeFloatBE(-(x as any), 8);
  console.log("a Buffer", hexOf(buffer));
  into.fill((x as any) + 1);
  console.log("filled", hexOf(into));
  const list = [(x as any) + 1, -(x as any), 1.5];
  list.push((x as any) * 2);
  into.set(list.slice(0, 3));
  console.log("a list", hexOf(into), hexOf(new Float64Array(list)));
}
for (let turn = 0; turn < 2; turn++) {
  mixed(late, turn === 0);
}
