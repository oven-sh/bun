// `c === "x"` in a loop, with one character from every place one can come from.
function isX(c) {
  return c === "x";
}
function isComma(c) {
  return c === ",";
}
function isWide(c) {
  return c === "é";
}
const text = "a,x,é,xx," + JSON.parse('"x"') + ",ሴx";
const values = [
  text[2],
  text.charAt(2),
  text.slice(2, 3),
  text.at(2),
  JSON.parse('"x"'),
  JSON.parse('{"x":1}') && Object.keys(JSON.parse('{"x":1}'))[0],
  String.fromCharCode(120),
  String.fromCodePoint(120),
  "xx".slice(1),
  "ሴx".slice(1),
  [..."ax"][1],
  "x".repeat(1),
  "X".toLowerCase(),
  "a" + "",
  "",
  "xx",
  120,
  null,
  text[4],
  JSON.parse('"é"'),
  String.fromCharCode(233),
  ",",
  text[1],
];
let answers = "";
for (const value of values) {
  let x = 0, comma = 0, wide = 0;
  for (let turn = 0; turn < 3000; turn++) {
    if (isX(value)) x++;
    if (isComma(value)) comma++;
    if (isWide(value)) wide++;
  }
  answers += (x ? "x" : comma ? "," : wide ? "w" : "-");
}
console.log(answers);
let counts = [0, 0, 0];
for (let turn = 0; turn < 2000; turn++)
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "x") counts[0]++;
    else if (c === ",") counts[1]++;
    if (text.charAt(i) === "é") counts[2]++;
  }
console.log(counts.join(" "));
