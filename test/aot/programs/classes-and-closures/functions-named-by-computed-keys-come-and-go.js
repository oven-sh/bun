// Classes, methods and functions that take their names from keys made at run time are made and dropped. The process holds no more at the end than after the first tenth.
function make(key) {
  class Made {
    [key]() {}
    static [key + " static"]() {}
    get [key + " read"]() {
      return 1;
    }
  }
  const literal = {
    [key]() {},
    [key + " function"]: function () {},
    [key + " arrow"]: () => 1,
    [key + " class"]: class {},
  };
  const defined = function () {};
  Object.defineProperty(defined, "name", { value: key + " defined" });
  return Made.prototype[key].name.length + literal[key + " class"].name.length + defined.name.length;
}

const rounds = 200_000;
let lengths = 0;
let early = 0;
for (let round = 0; round < rounds; round++) {
  lengths += make("a name that is long enough to count, number " + round);
  if (round === rounds / 10) {
    Bun.gc(true);
    early = process.memoryUsage().rss;
  }
}
Bun.gc(true);
console.log(lengths, process.memoryUsage().rss - early < 48 * 2 ** 20);
