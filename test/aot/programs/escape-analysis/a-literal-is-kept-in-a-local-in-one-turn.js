// An object literal is made in every turn of a hot loop and kept, in a local that starts as null, in one turn only. The variable of the function that makes it may also hold a Proxy of it, so the loop has a path on which anything may come back.
function make(value, keep) {
  const made = { value, tag: "made" };
  if (keep) return made;
  return made.value + 1;
}
function main() {
  let total = 0, kept = null;
  for (let i = 0; i < 1000; i++) {
    const result = make(i, i === 777);
    if (typeof result === "number") total += result; else kept = result;
  }
  return [total, kept.value, kept.tag].join(" ");
}
let last = "";
for (let r = 0; r < 50; r++) last = main();
console.log(last);
function replace() { make = new Proxy(make, {}); }
if (last === "") replace();
