addEventListener("ping", event => {
  console.log(typeof event.target.process.finalization);
});
const { dispatchEvent: send } = new EventTarget();
send(new Event("ping"));
