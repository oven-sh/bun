// A `using` block entered again after a collection that found no live disposable stack.
function disposeSixResources(round) {
  const order = [];
  const create = name => ({
    [Symbol.dispose]() {
      order.push(name);
    },
  });
  {
    using a = create("a");
    using b = create("b");
    using c = create("c");
    using d = create("d");
    using e = create("e");
    using f = create("f");
    order.push("body " + round);
  }
  return order.join();
}

for (let round = 0; round < 3; round++) {
  console.log(disposeSixResources(round));
  Bun.gc(true);
}
