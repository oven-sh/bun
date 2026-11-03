// Headers and URLSearchParams are made from records that hold a symbol in front of, between or behind names whose values are objects; what the values print shows how far each conversion came, also where a value changes the record.
function pick(name) {
  return Symbol[name];
}
const unknown = pick("asyncDispose");
const known = Symbol("known");
function text(label, change) {
  return {
    toString() {
      console.log("  asked for", label);
      change?.();
      return label;
    },
  };
}
function attempt(label, make) {
  for (const Class of [Headers, URLSearchParams]) {
    try {
      console.log(label, Class.name, [...new Class(make())]);
    } catch (error) {
      console.log(label, Class.name, error.constructor.name, error.message);
    }
  }
}
for (const symbol of [unknown, known]) {
  attempt("symbol, name", () => ({ [symbol]: "x", a: text("a") }));
  attempt("name, symbol", () => ({ a: text("a"), [symbol]: "x" }));
  attempt("name, symbol, name", () => ({ a: text("a"), [symbol]: "x", b: text("b") }));
  attempt("a hidden symbol", () => Object.defineProperty({ a: text("a"), b: text("b") }, symbol, { value: "x" }));
  attempt("below nothing", () => ({ __proto__: null, a: text("a"), [symbol]: "x", b: text("b") }));
  attempt("below a literal", () => ({ __proto__: { above: "c" }, a: text("a"), [symbol]: "x", b: text("b") }));
  attempt("an instance", () => {
    class Record {
      a = text("a");
      [symbol] = "x";
      b = text("b");
    }
    return new Record();
  });
  attempt("the symbol is deleted in time", () => {
    const record = { a: text("a", () => delete record[symbol]), [symbol]: "x", b: text("b") };
    return record;
  });
  attempt("the symbol is hidden in time", () => {
    const record = {
      a: text("a", () => Object.defineProperty(record, symbol, { enumerable: false })),
      [symbol]: "x",
      b: text("b"),
    };
    return record;
  });
}
attempt("names alone", () => ({ a: text("a"), b: "b", c: text("c") }));
attempt("a name is deleted", () => {
  const record = { a: text("a", () => delete record.b), b: text("b"), c: text("c") };
  return record;
});
attempt("a name is added", () => {
  const record = { a: text("a", () => (record.d = "d")), b: text("b") };
  return record;
});
attempt("a name is stored anew", () => {
  const record = { a: text("a", () => (record.b = "other")), b: text("b") };
  return record;
});
attempt("a name becomes a getter", () => {
  const record = {
    a: text("a", () => Object.defineProperty(record, "b", { get: () => text("from the getter"), enumerable: true })),
    b: text("b"),
  };
  return record;
});
