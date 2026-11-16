// The same change, made by text that the compiler has not seen.
class Plain { id; constructor(id) { this.id = id; this.by = "plain"; } }
class Other { constructor(id) { this.id = -id; this.by = "other"; } }
class Noted extends Plain { mark; constructor(id) { super(id); this.mark = id + 1; } }
globalThis.classes = { Noted, Other };
const change = (text) => (0, eval)(text);
function run(count) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    if (i === 5)
      change("Object.setPrototypeOf(classes.Noted, classes.Other);");
    const made = new Noted(i);
    parts.push(made.id + made.by + made.mark + (made instanceof Plain ? "P" : "-") + (made instanceof Other ? "O" : "-") + Object.keys(made).join(""));
  }
  return parts.join(" ");
}
console.log(run(10));
