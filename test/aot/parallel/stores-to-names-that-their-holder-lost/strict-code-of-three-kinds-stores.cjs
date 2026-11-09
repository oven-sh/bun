const shelf = { count: 1, width: 1, depth: 1 };
const outcomes = [];
with (shelf) {
  class Clerk {
    static method() {
      count = (delete shelf.count, 2);
    }
    static arrow = () => {
      width = (delete shelf.width, 2);
    };
    static nested() {
      function inner() {
        depth = (delete shelf.depth, 2);
      }
      inner();
    }
  }
  for (const run of [Clerk.method, Clerk.arrow, Clerk.nested]) {
    try {
      run();
      outcomes.push("stored");
    } catch (error) {
      outcomes.push(error.name);
    }
  }
}
console.log(outcomes.join(), Object.keys(shelf).join() || "empty");
