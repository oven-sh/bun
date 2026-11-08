const enum Name {
  Send = "dispatchEvent",
}
const { signal } = new AbortController();
const event = new Event("ping");
const send = (signal as any)[Name.Send];
send(event);
console.log(typeof (event.target as any).process.finalization);
