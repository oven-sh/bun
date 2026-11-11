// The compiler does not follow a method of EventTarget.prototype that the program finds without writing its name. Called without a receiver it works on the global object and the event
// answers that as its `target`, and this executable has left out part of what the global object leads to. The read says so, can be caught, and the program goes on. `bun run` prints "object".
// The output is stored: docs/compiler/compatibility.mdx declares the difference.
let add, send;
const made = Object.create(EventTarget.prototype);
for (const key in made) {
  if (key.length === 16) add = made[key];
  if (key.length === 13) send = made[key];
}
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
