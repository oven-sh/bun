const event = new Event("ping");
Reflect.apply(dispatchEvent, undefined, [event]);
console.log(typeof event.target.process.finalization);
