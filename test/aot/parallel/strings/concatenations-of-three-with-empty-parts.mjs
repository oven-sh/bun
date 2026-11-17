// A concatenation of three strings of which some are empty, flat, ropes, substrings or wide.
const long = "0123456789".repeat(30);
const kinds = [
  () => "",
  () => "a",
  n => "rope" + n + "end",
  () => long.slice(3, 260),
  () => "中",
  n => "中" + n + long,
  n => ("" + n).slice(5),
];
function join(a, b, c) {
  return a + b + c;
}
function rows(height, width, last) {
  let text = "";
  for (let y = 0; y < height; y++) {
    let line = y % 2 ? ">" : "";
    for (let x = 0; x < width; x++) line = x + line;
    text += line + (y < height - 1 ? "/" : last);
  }
  return text;
}
const said = [];
for (let i = 0; i < kinds.length; i++)
  for (let j = 0; j < kinds.length; j++)
    for (let k = 0; k < kinds.length; k++) {
      const joined = join(kinds[i](i), kinds[j](j), kinds[k](k));
      let sum = joined.length;
      for (let at = 0; at < joined.length; at += 7) sum = (sum * 31 + joined.charCodeAt(at)) | 0;
      said.push(i + "" + j + k + ":" + joined.length + ":" + sum);
    }
for (const [height, width] of [
  [0, 2],
  [1, 0],
  [1, 3],
  [4, 3],
  [3, 0],
])
  for (const last of ["", "中", "."]) said.push(rows(height, width, last));
console.log(said.join("\n"));
