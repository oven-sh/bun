// This literal never leaves compiled code, so its fields are held to what the program stores. A parsed object with the same names and other values goes through the same functions.
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a layout that stays with compiled code
function total(point) { return point.x + point.y; }
function scale(point, by) { point.x *= by; point.y *= by; return point; }
const lines = [];
const mine = { x: 1, y: 2 };
lines.push(total(scale(mine, 2)));
for (const text of ['{"x":"a","y":"b"}', '{"x":1,"y":null}', '{"y":3,"x":4}', '{"x":[1],"y":{}}', '{"x":9007199254740993,"y":0.5}']) {
  const parsed = JSON.parse(text);
  lines.push(String(total(parsed)), JSON.stringify(scale(parsed, 2)));
}
lines.push(total(scale(mine, 2)), JSON.stringify(mine));
console.log(lines.join("\n"));
