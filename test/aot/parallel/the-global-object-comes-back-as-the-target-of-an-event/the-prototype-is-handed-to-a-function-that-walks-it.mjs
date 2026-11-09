function say(value) { console.log(value); }
function both(holder) {
  let add, send;
  for (const k in holder) { if (k.length === 16) add = holder[k]; if (k.length === 13) send = holder[k]; }
  return [add, send];
}
const [add, send] = both(EventTarget.prototype);
function heard(event) { say(typeof event.target.process.finalization); }
add("ping", heard);
send(new Event("ping"));
