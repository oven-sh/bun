// The build writes the length of a text that a constant holds as a number. Here: texts with characters of one, two and four bytes, the other ways to spell the read, a name that shadows the constant, a name that changes, and a constant of a loop's body.
const held = "nine long";
const wide = "żółć and 漢字 and 😀";
console.log(held.length, wide.length, held["length"], held?.length, (held as string).length, `${held.length}`, held.length + wide.length);
function inside() { return held.length * 2; }
console.log(inside(), [held.length].map(n => n + 1)[0], typeof held.length);
const text = "outer text";
function shadowed(text: { length: number }) { return text.length; }
function other() { const text = ["a", "b"]; return text.length; }
class Holder { text = "field"; get size() { return this.text.length; } }
console.log(text.length, shadowed({ length: 77 }), other(), new Holder().size);
let changed = "first";
console.log(changed.length);
changed = "the second one";
console.log(changed.length);
const seen: number[] = [];
for (let turn = 0; turn < 2; turn++) { // @ts-expect-error
  try { seen.push(inLoop.length); } catch (error: any) { seen.push(-1); }
  const inLoop = "in the loop";
  seen.push(inLoop.length);
}
console.log(seen.join());
