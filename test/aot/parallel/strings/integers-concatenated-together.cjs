// STATISTIC: IntegersConcatenatedTogether >= 3
// `${x}, ${y}, ${z}`: several int32s and short strings are written into one string.
const edges = [0, 1, 9, 10, 99, 100, 999, 1000, 1023, 1024, 9999, 10000, 99999, 99999999, 100000000, 999999999, 1000000000, 2147483647, -1, -9, -10, -9999, -10000, -99999999, -100000000, -2147483647, -2147483648];
const names = ["", "a", "é", "中", "lorem ipsum ".repeat(4), "lorem ipsum ".repeat(5), "x".repeat(300)];
function pair(a, b) {
  return `${a | 0}:${b | 0}`;
}
function triple(a, b, c, name) {
  return `${name}(${a | 0}, ${b | 0}, ${c | 0})`;
}
function joined(a, b, c, d, e) {
  return [a | 0, b | 0, c | 0, d | 0, e | 0].join(" ");
}
function between(a, b, name, other) {
  return name + (a | 0) + other + (b | 0) + name;
}
function many(a, b) {
  const x = a | 0, y = b | 0;
  return `${x}${y}${x}${y}${x}${y}${x}${y}${x}${y}${x}${y}${x}${y}${x}${y}${x}${y}${x}${y}${x}${y}${x}${y}${x}${y}${x}${y}`;
}
let text = "", hash = 0;
for (let i = 0; i < edges.length; i++) {
  const a = edges[i], b = edges[edges.length - 1 - i], c = edges[(i * 7) % edges.length];
  const line = [pair(a, b), joined(a, b, c, i, -i), many(a, c)];
  for (const name of names) {
    const whole = triple(a, b, c, name);
    line.push(whole.length > 100 ? whole.length + whole.slice(-40) : whole, between(a, c, name, names[i % names.length]).length);
    text += triple(c, a, b, name) + "\n";
    hash = (Math.imul(hash, 31) + text.charCodeAt(text.length - 3)) | 0;
  }
  console.log(line.join("|"));
}
console.log(text.length, hash, pair(1.5, "7"), triple(null, undefined, true, "v"), joined(1, 2, 3, 4, 5) === "1 2 3 4 5");
const map = new Map();
for (let i = 0; i < 200; i++) map.set(`${i % 14 + 5000},${i % 10 + 70000}`, i);
console.log(map.size, map.get("5003,70003"), JSON.stringify([...map].slice(0, 3)), Object.keys(Object.fromEntries(map))[5]);
const large = [305419896, -1, 2147483647, -2147483648, 99999999, 100000000, 7, 10000];
console.log(large.join(), large.join(" "), large.join(""), String(large), [1e9, 1.5, -123456789].join("-"), JSON.stringify(large));
