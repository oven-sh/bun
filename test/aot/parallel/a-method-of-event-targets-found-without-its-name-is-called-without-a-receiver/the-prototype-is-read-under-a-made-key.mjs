// The holder of the methods is itself read under a key that is put together while the program runs. `bun run` prints "object".
// The output is stored: docs/compiler/compatibility.mdx declares the difference.
function both(holder) {
  const found = {};
  for (const key in holder) found[key.length] = holder[key];
  return [found[16], found[13]];
}
const [add, send] = both(EventTarget[["proto", "type"].join("")]);
function heard(event) {
  try {
    console.log(typeof event.target.process.finalization);
  } catch (error) {
    console.log(error.name + ": " + error.message);
  }
}
add("ping", heard);
console.log(send(new Event("ping")));
/* Output:
Error: process.finalization was not compiled into this executable because the compiler saw no use of it. Your code reached it through the `target` of an event on the global object. To keep it, write `void dispatchEvent` anywhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
true
*/
