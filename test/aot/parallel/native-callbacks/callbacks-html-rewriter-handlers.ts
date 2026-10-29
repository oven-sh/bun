// Callbacks handed over and methods found through instances: HTMLRewriter calls element, text and comments on a handler that is a class instance, with native objects, while the program's own calls pass strings.
let total = 0;

class Handler {
  seen: string[] = [];
  element(element: string): void {
    total += typeof element === "string" ? 1 : 100;
    if (typeof element !== "string") this.seen.push((element as any).tagName), (element as any).setAttribute("x", "1");
  }
  text(chunk: string): void {
    total += typeof chunk === "string" ? 10000 : 100000;
    if (typeof chunk !== "string" && (chunk as any).text) this.seen.push((chunk as any).text);
  }
  comments(comment: string): void {
    total += typeof comment === "string" ? 10000000 : 100000000;
  }
}

const handler = new Handler();
handler.element("own");
handler.text("own");
handler.comments("own");
const output = new HTMLRewriter().on("p", handler as any).transform("<p>one<!--c--></p><div>two</div><p>three</p>");
console.log(total, handler.seen.join(), output);
