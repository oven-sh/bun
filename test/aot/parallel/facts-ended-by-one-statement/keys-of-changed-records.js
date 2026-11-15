function make(i) {
  const o = { b: i, a: i };
  if (i % 2) o.c = 1;
  return o;
}
function keys(o) {
  let text = "";
  for (const k in o) text += k;
  return text + Object.keys(o).length;
}
let text = "";
for (let i = 0; i < 4; i++) {
  const o = make(i);
  if (i === 2) {
    delete o.b;
    o.b = 1;
  }
  if (i === 3) Object.defineProperty(o, "a", { enumerable: false });
  text += keys(o) + " ";
}
console.log(text);
const copy = { ...make(1), z: 0 };
copy[2] = "n";
copy["1"] = "m";
console.log(keys(copy), JSON.stringify(copy), Object.entries(copy).join(";"));
