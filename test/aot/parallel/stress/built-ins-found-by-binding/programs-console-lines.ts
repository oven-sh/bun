// Built ins found by binding: programs console lines. It prints what plain Bun prints.
console.log(Object.hasOwn(console, Symbol.asyncIterator), typeof console[Symbol.asyncIterator]);
let count = 0;
for await (const line of console) {
  console.log("line " + line.toUpperCase());
  if (++count === 2) break;
}
console.log(count);
