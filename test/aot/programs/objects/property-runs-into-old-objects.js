// Three named stores in a row into ordinary objects that survived a full collection. The stored values are young cells, so only a write barrier keeps them alive through the young collections that follow.
const keys = ["key"];

function create(i) {
  const target = {};
  target[keys[0]] = i;
  return target;
}

function fill(target, i) {
  target.a = "a" + i;
  target.b = [i];
  target.c = { at: i };
}

function isFilled(target, i) {
  return target.a === "a" + i && target.b[0] === i && target.c.at === i;
}

function garbage(count) {
  let total = 0;
  for (let i = 0; i < count; i++) total += [i, "g" + i].length;
  return total;
}

const old = [];
for (let i = 0; i < 64; i++) old.push(create(i));
Bun.gc(true);

let damaged = 0;
for (let round = 0; round < 200; round++) {
  for (const target of old) fill(target, round);
  garbage(5000);
  for (const target of old) {
    if (!isFilled(target, round)) damaged++;
  }
}
Bun.gc(true);
console.log("damaged", damaged);
console.log(JSON.stringify(old[0]), JSON.stringify(old[63]), Object.keys(old[63]).join());
