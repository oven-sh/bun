// A box, its size and its style all have `width` and `height`, so all of them fit Partial<Style>. The box and the size hold numbers there, the style holds texts too.
declare const process: { readonly argv: readonly string[] };
export {};
type Length = number | "auto" | `${number}%`;
interface Size { width: number; height: number }
interface Style { width: Length; height: Length; gap: number; border: boolean }
const initial: Style = { width: "auto", height: "50%", gap: 0, border: false };
class Box {
  readonly style: Style;
  width = 0;
  height = 0;
  left = 0;
  constructor(style: Partial<Style>) { this.style = { ...initial, ...style }; }
  get outer(): number { return this.width + this.style.gap * 2 + (this.style.border ? 2 : 0); }
}
const resolve = (length: Length, whole: number): number => typeof length === "number" ? length : length === "auto" ? NaN : whole * Number.parseFloat(length) / 100;
function measure(box: Box, whole: number): Size {
  const width = resolve(box.style.width, whole), height = resolve(box.style.height, whole);
  return { width: Number.isNaN(width) ? whole / 3 : width, height: Number.isNaN(height) ? -0 : height };
}
const boxes = [new Box({}), new Box({ width: 12 }), new Box({ height: 7.5, border: true }), new Box({ width: "25%", gap: 3 }), new Box({ width: Infinity, height: "auto" }), new Box({ gap: undefined })];
let sum = 0;
for (let turn = 0; turn < 50; turn++) {
  for (const box of boxes) {
    const size = measure(box, turn + 0.5);
    box.width = size.width;
    box.height = size.height;
    if (Number.isFinite(box.outer)) sum += box.outer + size.height;
  }
}
console.log(sum.toFixed(6));
for (const box of boxes) console.log(JSON.stringify(box), Object.is(box.height, -0), 1 / box.height, JSON.stringify(measure(box, 8)));
// The same objects where the reader knows nothing of them.
const widthOf = (thing: any): unknown => thing.width;
const things: any[] = [boxes[1], boxes[1]!.style, measure(boxes[1]!, 4), boxes[3], boxes[3]!.style, { width: "wide" }, {}];
console.log(things.map(widthOf).join(" "), things.map(thing => typeof thing.height).join(" "));
for (const thing of things) thing.width = thing.width === undefined ? null : [thing.width];
console.log(JSON.stringify(things.map(widthOf)));
const changed: any = measure(boxes[2]!, 9);
changed.width = "now a text";
delete changed.height;
console.log(JSON.stringify(changed), "height" in changed, Object.keys(boxes[0]!).join(), Object.getOwnPropertyDescriptor(boxes[4], "width")!.value);
