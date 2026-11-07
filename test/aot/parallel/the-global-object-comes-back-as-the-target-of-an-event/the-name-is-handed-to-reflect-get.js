const { signal } = new AbortController();
const event = new Event("ping");
const send = Reflect.get(signal, "dispatchEvent");
send(event);
console.log(typeof event.target.process.finalization);
