const names = { send: "dispatchEvent" } as const;
const { signal } = new AbortController();
const event = new Event("ping");
const send = (signal as any)[names.send];
send(event);
console.log(typeof (event.target as any).process.finalization);
