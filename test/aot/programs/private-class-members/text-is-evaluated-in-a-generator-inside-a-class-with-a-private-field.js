// Generators that are written inside members of classes with private fields evaluate text. Two of the classes are created behind a call that always throws;
// the others are created, and the text reads, writes and asks for their private fields.
function show(run) {
  try {
    console.log(run());
  } catch (error) {
    console.log(`${error.constructor.name}: ${error.message}`);
  }
}

show(() => {
  BigUint64Array();
  const Counter = class {
    static get total() {
      function* each() {
        yield eval("1 + 1");
      }
      return [...each()];
    }
    #count = 1;
  };
  return Counter.total;
});

show(() => {
  Float16Array();
  class Meter {
    #level = 4;
    #raise() {
      return ++this.#level;
    }
    static async read(meter, text) {
      async function* each() {
        yield eval(text);
      }
      const values = [];
      for await (const value of each()) values.push(value);
      return values;
    }
  }
  return Meter.read(new Meter(), "meter.#raise()");
});

class Counter {
  #count = 1;
  static get total() {
    function* each(counter, texts) {
      for (const text of texts) yield eval(text);
    }
    return (counter, ...texts) => [...each(counter, texts)];
  }
}
show(() =>
  Counter.total(new Counter(), "#count in counter", "counter.#count", "counter.#count += 5", "counter.#count"),
);
show(() => Counter.total({}, "#count in counter", "counter.#count"));
show(() => Counter.total(new Counter(), "counter.#size"));

const Unused = class {
  #hidden = "kept";
  static get reader() {
    function* each(text, holder) {
      yield eval(text);
    }
    return each;
  }
};
show(() => [...Unused.reader("#hidden in holder", {})]);
show(() => [...Unused.reader("#hidden in holder", new Unused())]);
show(() => [...Unused.reader("holder.#hidden", new Unused())]);
