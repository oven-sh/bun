const pieces = [];
for (let length = 0; length <= 300; length++) pieces.push("abcdefghijklmnopqrstuvwxyz0123456789".repeat(9).slice(0, length));
pieces.push("é".repeat(5), "中文", "x" + "y".repeat(70000), ("r" + process.argv.length) + ("s" + process.argv.length));
function join(a, b, c) { return "<" + a + "|" + b + "|" + c + ">"; }
let sum = 0, text = "";
for (let i = 0; i < pieces.length; i++) {
  const joined = join(pieces[i], pieces[(i * 7 + 3) % pieces.length], pieces[pieces.length - 1 - i]);
  sum = (sum * 31 + joined.length) % 1000003;
  for (let k = 0; k < joined.length; k += 97) sum = (sum * 33 + joined.charCodeAt(k)) % 1000003;
  if (i % 50 === 0) text += `${pieces[i]}:${joined.length};`;
}
let long = "";
for (let i = 0; i < 400; i++) long = `${long}${pieces[i % 40]}-`;
console.log(sum, text.length, long.length, long.slice(-40));
