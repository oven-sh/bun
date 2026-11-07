const event = new Event("ping");
class Own extends EventTarget {
  send(given) {
    return (0, super.dispatchEvent)(given);
  }
}
new Own().send(event);
console.log(typeof event.target.process.finalization);
