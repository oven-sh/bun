const size = 1 << 30;
const bytes = Buffer.alloc(size);
bytes[size - 2] = 0xc3;
bytes[size - 1] = 0xa9;

function lengthOfText(view) {
  try {
    return view.toString("utf8").length;
  } catch (error) {
    if (error.message === "Failed to allocate memory") return view.length - 1;
    return `${error.name} ${error.message}`;
  }
}

function textOf(view, encoding, start, end) {
  try {
    return view.toString(encoding, start, end);
  } catch (error) {
    return `${error.name} ${error.message}`;
  }
}

let seed = 90217;
function next(limit) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return (seed >>> 8) % limit;
}

const encodings = [undefined, "utf8", "utf-8", "ascii", "latin1", "binary", "hex"];
const pieces = ["a", "Z", "7", " ", "é", "€", "\u{1f600}", "ÿ"];
let digest = 0;
let units = 0;
for (let round = 0; round < 4000; round++) {
  let source = "";
  for (let count = next(24); count > 0; count--) source += pieces[next(round % 2 ? 4 : pieces.length)];
  const view = round % 3 ? Buffer.from(source) : Buffer.from(source, "latin1");
  if (round % 5 === 0 && view.length) view[next(view.length)] = 128 + next(128);
  const start = next(3) ? undefined : next(view.length + 1);
  const end = next(3) ? undefined : next(view.length + 2);
  const text = textOf(view, encodings[next(encodings.length)], start, end);
  units += text.length;
  for (let place = 0; place < text.length; place++) digest = (Math.imul(digest, 31) + text.charCodeAt(place)) | 0;
}

console.log(units, digest);
console.log(lengthOfText(bytes));
