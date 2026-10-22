// setTimeout calls its callback with the timer as `this`. The program keeps the timer and compares it with what the callback got.
export {};

class Body {
  mass = 3;
  tell(): void {
    seen.push(this === undefined ? "none" : String(this.mass), String((this as unknown) === timer));
  }
}

const seen: string[] = [];
let timer: unknown;
const body = new Body();
body.tell();
timer = setTimeout(body.tell, 0);
setTimeout(() => console.log(seen.join(" ")), 30);
