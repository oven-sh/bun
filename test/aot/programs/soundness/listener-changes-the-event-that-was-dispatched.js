// performance.dispatchEvent hands its listeners the event that it was handed, not a copy.
class Ping extends Event {
  constructor(n) {
    super("ping");
    this.n = n;
  }
  twice() {
    return this.n * 2;
  }
}

const event = new Ping(21);
const other = new Ping(4);
let received;
performance.addEventListener("ping", value => {
  received = value;
  value.n = "x";
});
performance.dispatchEvent(event);
console.log(received === event, typeof event.n, event.twice());
console.log(typeof other.n, other.twice());
