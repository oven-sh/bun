// setInterval calls its callback with the timer as `this`. The program drops the timer, and the callback is the only one who can stop it.
export {};

class Body {
  mass = 3;
  tell(): void {
    seen.push(this === undefined ? "none" : String(this.mass));
    if (seen.length === 3) {
      clearInterval(this as any);
      console.log(seen.join(" "));
    }
  }
}

const seen: string[] = [];
const body = new Body();
body.tell();
setInterval(body.tell, 1);
