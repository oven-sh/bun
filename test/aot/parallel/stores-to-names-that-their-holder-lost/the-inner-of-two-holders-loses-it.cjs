const outer = { count: 10 };
const inner = { count: 1 };
let outcome = "stored";
with (outer) {
  with (inner) {
    class Clerk {
      static restock() {
        count = (delete inner.count, 2);
      }
    }
    try {
      Clerk.restock();
    } catch (error) {
      outcome = error.name;
    }
  }
}
console.log(outcome, "count" in inner, outer.count);
