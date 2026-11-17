// The constructor above throws in every third turn, behind its first store. One class below lets that pass. Another catches it round `super(..)`, where `this` is not bound yet, and calls `super(..)` again.
class Plain { id; constructor(id) { this.id = id; if (id % 3 === 2) throw new RangeError("r" + id); this.done = true; } }
class Passes extends Plain { mark; constructor(id) { super(id); this.mark = id; } }
class Catches extends Plain { mark; constructor(id) { try { super(id); } catch (error) { super(id + 1); this.caught = error.message; } this.mark = id; } }
function describe(made) { return made.id + ":" + made.done + ":" + made.mark + ":" + (made.caught ?? "-") + ":" + Object.keys(made).join(""); }
function run(count) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    let text;
    try {
      text = describe(new Passes(i));
    } catch (error) {
      text = error.message;
    }
    parts.push(text + "|" + describe(new Catches(i)));
  }
  return parts.join(" ");
}
console.log(run(9));
