// Only the event is sent without a receiver: it keeps the global object as its `target` with no listener at all. `bun run` prints "object".
// The output is stored: docs/compiler/compatibility.mdx declares the difference.
let send;
const made = Object.create(EventTarget.prototype);
for (const key in made) if (key.length === 13) send = made[key];
const event = new Event("ping");
send(event);
try {
  console.log(typeof event.target.process.finalization);
} catch (error) {
  console.log(error.name + ": " + error.message);
}
/* Output:
Error: process.finalization was not compiled into this executable because the compiler saw no use of it. Your code reached it through the `target` of an event on the global object. To keep it, write `void dispatchEvent` anywhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
