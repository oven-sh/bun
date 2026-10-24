// setTimeout and setImmediate of node:timers call their callbacks with the timer as `this`. The program drops both timers.
import timers from "node:timers";

class Body {
  mass = 3;
  tell(): void {
    seen.push(this === undefined ? "none" : String(this.mass));
  }
}

const seen: string[] = [];
const body = new Body();
body.tell();
timers.setTimeout(body.tell, 0);
timers.setImmediate(body.tell);
setTimeout(() => console.log(seen.join(" ")), 30);
