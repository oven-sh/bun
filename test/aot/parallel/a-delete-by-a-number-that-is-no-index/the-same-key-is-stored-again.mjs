// The key 4294967295 is deleted by the number and stored again at once: it moves to the end, as any name does.
const made = { a: 1, 4294967295: 2, x: 3 };
function run(o, key) {
  delete o[key];
  o[key] = 1;
}
run(made, JSON.parse("4294967295"));
console.log(Object.keys(made).join());
