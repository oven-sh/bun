// A turn adds a key and deletes the next one: what is added is not visited, what is deleted is passed by, and the names behind it still come.
function walk(o, change) {
  const seen = [];
  for (const k in o) {
    seen.push(k);
    if (change && k === "b") { o.z = 26; delete o.c; }
  }
  return seen.join() + " | " + Object.keys(o).join();
}
function deed() { return walk({ a: 1, b: 2, c: 3, d: 4 }, true); }
console.log(deed());
for (let i = 0; i < 4; i++) console.log(walk({ a: 1, b: 2, c: 3, d: 4 }, false), "|", deed());
console.log(walk(JSON.parse('{"a":1,"b":2,"c":3,"d":4}'), true));
