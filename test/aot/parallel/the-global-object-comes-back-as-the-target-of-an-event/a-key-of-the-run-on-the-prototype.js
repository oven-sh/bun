addEventListener("ping", event => {
  console.log(typeof event.target.process.finalization);
});
const send = EventTarget.prototype[JSON.parse('"dispatchEvent"')];
send(new Event("ping"));
