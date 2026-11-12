// The listener is added under the written name, the event is sent under a name that the program reads. `bun run` prints "object".
// The output is stored: the target of the event is the global object, and what it leads to was not loaded.
addEventListener("ping", event => {
  try {
    console.log(typeof event.target.process.finalization);
  } catch {
    console.log("caught");
  }
});
const send = new EventTarget()[JSON.parse('"dispatchEvent"')];
send(new Event("ping"));
console.log("behind");
/* Output:
caught
behind
*/
