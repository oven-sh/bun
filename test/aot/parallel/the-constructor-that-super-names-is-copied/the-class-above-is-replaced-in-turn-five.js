// In turn five another class is laid above the class object of Noted: `super(..)` calls whatever stands there when it runs. The prototype of Noted stays below that of Plain.
class Plain { id; constructor(id) { this.id = id; this.by = "plain"; } }
class Other { constructor(id) { this.id = -id; this.by = "other"; } }
class Noted extends Plain { mark; constructor(id) { super(id); this.mark = id + 1; } }
function run(count) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    if (i === 5)
      Object.setPrototypeOf(Noted, Other);
    const made = new Noted(i);
    parts.push(made.id + made.by + made.mark + (made instanceof Plain ? "P" : "-") + (made instanceof Other ? "O" : "-") + Object.keys(made).join(""));
  }
  return parts.join(" ");
}
console.log(run(10));
