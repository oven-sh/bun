const event = new Event("ping");
class Own extends EventTarget {
  send(given) {
    return super.dispatchEvent(given);
  }
}
const { send } = new Own();
send(event);
console.log(typeof event.target.process.finalization);
