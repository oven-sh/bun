// setTimeout calls its callback with the timer as `this`. The program drops the timer, and every call of its own goes through an instance.
export {};

class Body {
  mass = 3;
  tell(): void {
    seen.push(this === undefined ? "none" : String(this.mass));
  }
}

const seen: string[] = [];
const body = new Body();
body.tell();
setTimeout(body.tell, 0);
setTimeout(() => console.log(seen.join(" ")), 30);
