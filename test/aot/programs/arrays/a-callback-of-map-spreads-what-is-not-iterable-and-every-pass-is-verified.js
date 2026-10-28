globalThis.report = function (name, run) {
  try {
    console.log(name, "answers", run());
  } catch (error) {
    console.log(name, error.constructor.name, error.message);
  }
};

report("a number", function () {
  const unused = [1, 2].map(() => [...7]);
});
report("a boolean", function () {
  const unused = [1, 2].map(() => [...true]);
});
report("a symbol", function () {
  const unused = [1, 2].map(() => [...Symbol.iterator]);
});
report("a bigint", function () {
  const unused = [1, 2].map(() => [...7n]);
});
report("a number behind elements", function () {
  const unused = [1, 2].map(element => [element, ...7, element]);
});
report("a number or nothing", function () {
  const unused = [1, undefined].map(element => [...element]);
});
report("nothing or a number", function () {
  const unused = [null, 2].map(element => [...element]);
});
report("nothing", function () {
  const unused = [1, 2].map(() => [...undefined]);
});
report("a number, and the lists are read", function () {
  return [1, 2].map(() => [...7]).length;
});
report("a number among arguments", function () {
  const unused = [1, 2].map(() => Math.max(...7));
});
report("a number in a list that is empty", function () {
  return [].map(() => [...7]).length;
});
report("a number behind a string", function () {
  const unused = [1, 2].map(() => [..."ab", ...7]);
});
report("a number in a try", function () {
  return [1, 2].map(element => {
    try {
      return [...7];
    } catch (error) {
      return [element, error.constructor.name];
    }
  });
});
