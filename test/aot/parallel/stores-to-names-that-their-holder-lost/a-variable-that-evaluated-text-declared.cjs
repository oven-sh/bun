function room() {
  eval("var count = 1");
  const drop = () => delete count;
  class Clerk {
    static restock() {
      count = (drop(), 2);
    }
  }
  const sloppyStore = function () {
    count = (drop(), 3);
  };
  const outcomes = [];
  for (const run of [Clerk.restock, sloppyStore]) {
    try {
      run();
      outcomes.push("stored");
    } catch (error) {
      outcomes.push(error.name);
    }
    outcomes.push(typeof count);
    eval("var count = 1");
  }
  return outcomes.join();
}
console.log(room(), typeof globalThis.count);
