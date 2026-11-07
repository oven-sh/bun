// Pieces are joined with a separator by looking at the end of what has been gathered so far. The look may not put the text together anew at every turn.
// Sizes: 1000 4000 16000
// Passes: 50
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function byEndsWith(count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    if (out.length > 0 && !out.endsWith(",")) out += ",";
    out += "item" + (i & 7);
  }
  return out;
}
function byIndex(count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    if (out.length > 0 && out[out.length - 1] !== ";") out += ";";
    out += "item" + (i & 7);
  }
  return out;
}
function byCodeUnit(count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    if (out.length > 0 && out.charCodeAt(out.length - 1) !== 32) out += " ";
    out += "item" + (i & 7);
  }
  return out;
}
function byAt(count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    if (out.at(-1) !== "|" && i > 0) out += "|";
    out += "item" + (i & 7);
  }
  return out;
}
function bySlice(count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    if (i > 0 && out.slice(-1) !== "/") out += "/";
    out += "item" + (i & 7);
  }
  return out;
}
function once(): string {
  return [byEndsWith, byIndex, byCodeUnit, byAt, bySlice].map(join => { const text = join(size); return text.length + text.slice(-7); }).join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
