// STATISTIC: IntegersConcatenatedAroundString >= 2
// `${x},${y}`: the strings of two small integers are joined to a rope; other integers are written into one string.
const edges = [0, 1, 9, 10, 99, 100, 999, 1000, 1023, 1024, 9999, 10000, 99999, 99999999, 100000000, 2147483647, -1, -9, -10, -1024, -2147483648];
const names = ["", "a", "é", "中", "lorem ipsum ".repeat(4), "lorem ipsum ".repeat(5), "x".repeat(300)];
function comma(x, y) {
  return `${x | 0},${y | 0}`;
}
function around(x, name, y) {
  return `${x | 0}${name}${y | 0}`;
}
function joined(x, y) {
  return [x | 0, y | 0].join(":");
}
const map = new Map();
let hash = 0;
for (let i = 0; i < edges.length; i++) {
  const line = [];
  for (let j = 0; j < edges.length; j += 3) {
    const pair = comma(edges[i], edges[j]);
    map.set(pair, i * 100 + j);
    hash = (Math.imul(hash, 31) + pair.charCodeAt(pair.length >> 1)) | 0;
    line.push(pair, joined(edges[j], edges[i]));
  }
  for (const name of names) {
    const whole = around(edges[i], name, edges[(i * 5) % edges.length]);
    line.push(whole.length > 60 ? whole.length + whole.slice(0, 20) + whole.slice(-12) : whole);
  }
  for (const name of [names[1] + names[i % 3], String(i), i & 1 ? "odd" : "even"]) line.push(around(i, name, -i), around(i, name, i + 1020) === i + name + (i + 1020));
  console.log(line.join(" "));
}
console.log(map.size, hash, map.get("1023,1000"), map.get("-1,0"), comma(1.5, "7"), comma(null, undefined), JSON.stringify([...map].slice(0, 4)));
let text = "";
for (let i = 1000; i < 1050; i++) text += comma(i, i + 10) + ";";
console.log(text.length, text.slice(100, 140), text.slice(-30));
