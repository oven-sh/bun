// Callbacks handed over: what else a program holds decides how often the compiler expects a handler's method to run, and so which form its code takes. HTMLRewriter calls text() with a native object whatever that form is.
console.log(new CustomEvent("value", { detail: 1 }).detail);

class Handler {
  seen: string[] = [];
  text(chunk: string): void {
    if (typeof chunk !== "string" && (chunk as any).text) this.seen.push((chunk as any).text);
  }
}

const handler = new Handler();
handler.text("own");
const output = new HTMLRewriter().on("p", handler as any).transform("<p>one</p><div>two</div><p>three</p>");
console.log(handler.seen.join(), output);
