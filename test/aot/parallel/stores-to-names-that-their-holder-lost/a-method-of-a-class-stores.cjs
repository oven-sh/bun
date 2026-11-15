const shelf = { count: 1 };
let outcome = "stored";
with (shelf) {
  class Clerk {
    static restock() {
      count = (delete shelf.count, 2);
    }
  }
  try {
    Clerk.restock();
  } catch (error) {
    outcome = `${error.name}: ${error.message}`;
  }
}
console.log(outcome, "count" in shelf, typeof globalThis.count);
