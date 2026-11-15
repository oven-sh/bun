const { signal } = new AbortController();
const event = new Event("ping");
const name = "dispatchEvent";
const { [name]: send } = signal;
send(event);
console.log(typeof event.target.process.finalization);
