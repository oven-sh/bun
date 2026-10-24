// Sources of a spread: a source typed as an object is really a string, a number, null, an array or a function with properties, each out of `any`; what the copy holds follows from the real value.
let total = 0;

interface Size {
  width?: number;
  length?: number;
}

function widthOf(size: Size): number {
  const copy = { width: 1, ...size };
  total += typeof copy.width === "number" ? 1 : 100;
  return Object.keys(copy).length * 10 + (typeof copy.width === "number" ? copy.width : -1);
}

const withProperty: any = Object.assign(() => 0, { width: "wide" });
const sources: any[] = [{ width: 2 }, "ab", 5, null, undefined, [7, 8], withProperty, new Map([["width", 3]]), Object.create({ width: 4 }), Object.defineProperty({}, "width", { value: 5 }), new String("xyz")];
console.log(sources.map(widthOf).join(), total);
