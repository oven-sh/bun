globalThis.report = function (name, run) {
  try {
    console.log(name, "answers", run());
  } catch (error) {
    console.log(name, error.constructor.name, error.message);
  }
};

report("strings", function () {
  return ["ab", "", "c\u{1F600}d"].map(element => [...element]);
});
report("strings, then a number", function () {
  const seen = [];
  try {
    return ["ab", "cd", 7, "ef"].map(element => {
      const list = [...element];
      seen.push(list);
      return list;
    });
  } finally {
    console.log(seen);
  }
});
report("strings, then nothing", function () {
  const seen = [];
  try {
    return ["ab", undefined, "ef"].map(element => {
      const list = [element, ...element];
      seen.push(list);
      return list;
    });
  } finally {
    console.log(seen);
  }
});
report("strings, lists and a boolean", function () {
  const seen = [];
  try {
    return ["ab", [1, 2], false].map(element => {
      const list = [...element, ...element];
      seen.push(list);
      return list;
    });
  } finally {
    console.log(seen);
  }
});
