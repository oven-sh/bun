// text.indexOf(searched, position), text.slice(start, end), text.charAt(position) where the text is known to be a string and an argument could be anything, and where nothing at all is known.
const box = JSON.parse(JSON.stringify({ texts: ["", "a", "/users/42?x=1&y=2", "café au lait", "€😀\ud800z", "aaaaabaaaab", "x".repeat(70) + "?" + "y".repeat(9)], searched: ["", "a", "?", "ab", "é", "\ud83d", "zz", "aaab", "/users/42?x=1&y=2", "y?"] }));
const positions = [undefined, null, 0, 1, 2, 5, -1, -3, 17, 18, 1000, -1000, 2147483647, -2147483648, 4294967296, 1.5, -1.5, NaN, Infinity, -Infinity, -0, "2", "x", "", true, false, [], [3], {}, { valueOf() { return 4; } }, 3n === 3n];
const throwing = [Symbol("s"), 5n, { valueOf() { throw new RangeError("from valueOf"); } }];
function find(text, table, i, other, j) { return typeof text === "string" ? text.indexOf(table[i], other[j]) : -2; }
function findAlone(text, table, i) { return typeof text === "string" ? text.indexOf(table[i]) : -2; }
function cut(text, table, i, j) { return typeof text === "string" ? text.slice(table[i], table[j]) : ""; }
function cutAlone(text, table, i) { return typeof text === "string" ? text.slice(table[i]) : ""; }
function at(text, table, i) { return typeof text === "string" ? text.charAt(table[i]) : ""; }
function findOfAnything(table, i, searched, position) { return String.prototype.indexOf.call(table[i], searched, position); }
function cutOfAnything(table, i, start, end) { return String.prototype.slice.call(table[i], start, end); }
function atOfAnything(table, i, position) { return String.prototype.charAt.call(table[i], position); }
const code = text => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(36)).join(".");
let lines = [];
for (let round = 0; round < 12; round++) {
  lines = [];
  for (const text of box.texts) {
    lines.push("find " + box.searched.map((_, i) => positions.map((_, j) => find(text, box.searched, i, positions, j)).join()).join(";"));
    lines.push("find alone " + box.searched.map((_, i) => findAlone(text, box.searched, i)).join() + " | " + positions.map((_, i) => findAlone(text, positions, i)).join());
    lines.push("cut " + positions.map((_, i) => positions.map((_, j) => cut(text, positions, i, j).length).join("")).join(","));
    lines.push("cut alone " + positions.map((_, i) => code(cutAlone(text, positions, i)).length).join());
    lines.push("at " + positions.map((_, i) => code(at(text, positions, i))).join());
  }
  const receivers = [...box.texts.slice(0, 3), 12345, true, [1, 2, 3], { toString() { return "object text"; } }, new String("wrapped"), 10n];
  lines.push(receivers.map((_, i) => [findOfAnything(receivers, i, "2", 1), cutOfAnything(receivers, i, 1, -1), atOfAnything(receivers, i, 2)].join("|")).join());
  for (const bad of [undefined, null, Symbol("r")]) lines.push([findOfAnything, cutOfAnything, atOfAnything].map(f => { try { return f([bad], 0, 1, 2); } catch (error) { return error.name; } }).join());
  lines.push(throwing.map((_, i) => [() => find("abc", box.searched, 1, throwing, i), () => find("abc", throwing, i, positions, 0), () => cut("abc", throwing, i, i), () => at("abc", throwing, i)].map(f => { try { return String(f()); } catch (error) { return error.name; } }).join("|")).join());
}
console.log(lines.join("\n"));
const rope = box.texts[2] + box.texts[5] + String(box.texts.length);
console.log(find(rope, box.searched, 2, positions, 3), cut(rope, positions, 4, 8), at(rope, positions, 5), find(("x".repeat(300) + box.texts[2]) + "?", box.searched, 2, positions, 0), cut(rope.slice(2, 20), positions, 3, 6));
const order = []; const noting = name => ({ valueOf() { order.push(name); return 1; }, toString() { order.push(name + " as text"); return "a"; } });
find("banana", [noting("searched")], 0, [noting("position")], 0); cut("banana", [noting("start"), noting("end")], 0, 1); at("banana", [noting("index")], 0); console.log(order.join());
