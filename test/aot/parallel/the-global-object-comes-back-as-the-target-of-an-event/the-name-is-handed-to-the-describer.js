const { signal } = new AbortController();
const event = new Event("ping");
const above = Object.getPrototypeOf(Object.getPrototypeOf(signal));
const send = Object.getOwnPropertyDescriptor(above, "dispatchEvent").value;
send(event);
console.log(typeof event.target.process.finalization);
