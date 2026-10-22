// The key is put together at run time, on the object itself and on a value that nobody follows.
const tail = process.argv.length > 100 ? "in" : "out";
const key = "_std" + tail;
console.log(console[key] === process.stdout);

function pick(holder, name) {
  return holder[name];
}
const holders = [{ _stdout: 1 }, console, new Map()];
const chosen = holders[process.argv.length > 100 ? 0 : 1];
console.log(pick(chosen, key) === process.stdout, pick(holders[0], key), pick(holders[2], key));
console.log(Reflect.get(console, "_std" + (tail === "out" ? "err" : "x")) === process.stderr);

const parsed = JSON.parse('{"a":1}', function (name, value) {
  return name === "a" ? console : value;
});
console.log(parsed.a[key] === process.stdout, parsed.a._stderr === process.stderr);
