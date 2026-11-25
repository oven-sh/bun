// A rope of many pieces is made flat once.
// Sizes: 1000 4000 16000
// Passes: 750
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function grow(count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) text += "piece " + (i & 255) + ";";
  return text;
}
function once(): string {
  const text = grow(size * 4);
  let seen = 0;
  for (let at = 0; at < text.length; at += 7) seen = (seen + text.charCodeAt(at)) | 0;
  return [text.length, seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
