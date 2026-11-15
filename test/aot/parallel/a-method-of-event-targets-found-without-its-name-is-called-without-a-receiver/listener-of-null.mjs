// No listener at all: the written call alone.
addEventListener("ping", null);
const send = new EventTarget()[JSON.parse('"dispatchEvent"')];
const event = new Event("ping");
send(event);
try {
  console.log(typeof event.target.process.finalization);
} catch (error) {
  console.log(error.name + ": " + error.message.split(" because")[0]);
}
console.log(typeof event.target.Buffer.from, event.target.Array.from([1]).length);
/* Output:
Error: process.finalization was not compiled into this executable
function 1
*/
