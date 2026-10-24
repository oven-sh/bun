// Methods found through instances: an EventTarget calls handleEvent on a listener that is an object, with an Event, while every call in the program passes a number.
let total = 0;

class Recorder {
  seen = 1;
  handleEvent(event: number): void {
    total += typeof event === "number" ? event : (event as any) instanceof Event ? 100 * this.seen : 10000;
    total += typeof event === "object" && (event as any).type === "ping" ? 100000 : 0;
    this.seen++;
  }
}

const recorder = new Recorder();
recorder.handleEvent(1);
const target = new EventTarget();
target.addEventListener("ping", recorder as any);
target.addEventListener("pong", recorder as any, { once: true });
target.dispatchEvent(new Event("ping"));
target.dispatchEvent(new CustomEvent("pong", { detail: 5 }));
target.dispatchEvent(new Event("pong"));
const controller = new AbortController();
controller.signal.addEventListener("abort", recorder as any);
controller.abort("reason");
console.log(total, recorder.seen);
