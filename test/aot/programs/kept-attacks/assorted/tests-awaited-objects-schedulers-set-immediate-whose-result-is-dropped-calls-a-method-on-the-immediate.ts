// setImmediate calls its callback with the Immediate object as `this`. The program drops that object, and every call of its own goes through an instance.
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
setImmediate(body.tell);
setTimeout(() => console.log(seen.join(" ")), 30);
