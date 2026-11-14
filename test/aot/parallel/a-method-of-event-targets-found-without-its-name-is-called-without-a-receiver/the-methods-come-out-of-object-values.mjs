// The methods are found without any name at all. `bun run` prints "object".
// The output is stored: docs/compiler/compatibility.mdx declares the difference.
const { signal } = new AbortController();
const found = Object.values(Object.getPrototypeOf(Object.getPrototypeOf(signal)));
const add = found.find(value => value.name.length === 16);
const send = found.find(value => value.name.length === 13);
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
