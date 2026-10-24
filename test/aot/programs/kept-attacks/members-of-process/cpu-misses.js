// Members of process: cpu misses. It prints what plain Bun prints.
function read(o) { return o.a; }
function has(o) { return "a" in o; }
const objects = [{ a: 1 }, { a: 2, b: 1 }, { a: 3, c: 1 }, JSON.parse('{"a":4}'), function f() {}, [1], new Map(), Object.assign({ z: 1 }, JSON.parse('{"a":5,"q":1}'))];
let sum = 0;
for (let i = 0; i < 4; i++) {
  for (const o of objects) {
    if (has(o)) sum += read(o);
  }
}
console.log(sum, read("text"));
