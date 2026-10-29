// Objects whose names come in very many orders are made, held over a collection, dropped and collected: now many of them, now few, now none.
const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
function order(number) {
  const left = [...letters];
  const out = [];
  for (let size = left.length; size > 0; size--) {
    out.push(left.splice(number % size, 1)[0]);
    number = Math.floor(number / size);
  }
  return out;
}
const textOf = names => "{" + names.map((name, at) => '"' + name + '":' + at).join(",") + "}";

let from = 0;
function round(count, make) {
  let kept = [];
  for (let at = 0; at < count; at++) kept.push(make(order(from++)));
  Bun.gc(true);
  let wrong = 0;
  kept.forEach((value, at) => {
    if (Object.keys(value).join("") !== order(from - count + at).join("")) wrong++;
  });
  kept = [];
  Bun.gc(true);
  Bun.gc(true);
  return wrong;
}
const parsed = names => JSON.parse(textOf(names));
const written = names => {
  const made = {};
  for (const name of names) made[name] = 1;
  return made;
};
class Point {
  x = 0;
}
const onAnInstance = names => {
  const made = new Point();
  delete made.x;
  for (const name of names) made[name] = 1;
  return made;
};
for (const make of [parsed, written, onAnInstance]) {
  const line = [];
  for (const count of [100, 20000, 10, 5000, 40000, 1, 300, 20000, 0, 2500, 128, 256, 512, 1024, 2048, 4096, 8192, 4096, 2048, 1024, 512, 256, 128, 0]) line.push(count + ":" + round(count, make));
  console.log(make.name, line.join(" "));
}
