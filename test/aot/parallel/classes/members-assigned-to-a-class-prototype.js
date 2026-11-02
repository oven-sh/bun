// Accessors and methods that a program puts on the prototype object of a class declaration: read, stored and called before they are there, while they are there, and after they are replaced, hidden or deleted.
const lines = [];
function often(label, body) {
  let last;
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    try {
      last = body(i);
    } catch (error) {
      last = error.constructor.name;
    }
    seen.add(String(last));
  }
  lines.push(`${label}: ${[...seen].join(" ")}`);
}

class Record {
  values = { id: 1, size: 2 };
  own() {
    return "own";
  }
}
const readId = record => record.id;
const storeSize = (record, value) => ((record.size = value), record.values.size);
const callTwice = record => record.twice();
const early = new Record();
often("before: read", () => readId(early));
often("before: store", i => storeSize(new Record(), i & 1));
often("before: call", () => callTwice(early));
lines.push(Object.keys(early).join());

Object.defineProperty(Record.prototype, "id", {
  get() {
    return this.values.id;
  },
  enumerable: true,
  configurable: true,
});
Object.defineProperty(Record.prototype, "size", {
  get() {
    return this.values.size;
  },
  set(value) {
    this.values.size = value * 10;
  },
  configurable: true,
});
Record.prototype.twice = function () {
  return this.values.id * 2;
};
const late = new Record();
often("there: read", () => readId(late));
often("there: read of the early one", () => readId(early));
often("there: store", i => storeSize(late, i & 1));
often("there: call", () => callTwice(late));
lines.push(Object.keys(late).join(), Object.getOwnPropertyNames(Record.prototype).join());

class Below extends Record {
  get id() {
    return "below";
  }
}
class Plain extends Record {}
often("below: read", i => readId(i & 1 ? new Below() : new Plain()));
often("below: call", () => callTwice(new Plain()));

const hidden = new Record();
Object.defineProperty(hidden, "id", { value: "hidden" });
hidden.twice = () => "hidden too";
often("hidden: read", i => readId(i & 1 ? hidden : late));
often("hidden: call", i => callTwice(i & 1 ? hidden : late));

Object.defineProperty(Record.prototype, "id", {
  get() {
    return "replaced";
  },
  configurable: true,
});
Record.prototype.twice = () => "replaced too";
often("replaced: read", () => readId(late));
often("replaced: read below", () => readId(new Plain()));
often("replaced: call", () => callTwice(late));

Object.defineProperty(Record.prototype, "size", { value: "data", writable: true, configurable: true });
often("data: store", i => storeSize(new Record(), i & 1));
often("data: read", () => late.size);

delete Record.prototype.id;
delete Record.prototype.twice;
often("deleted: read", () => readId(late));
often("deleted: call", () => callTwice(late));

function make(tag) {
  class Made {
    tag = tag;
  }
  Object.defineProperty(Made.prototype, "label", {
    get() {
      return `${tag}:${this.tag}`;
    },
  });
  return Made;
}
const [First, Second] = [make("first"), make("second")];
often("made twice", i => new (i & 1 ? First : Second)().label);

class Mixed {
  n = 3;
}
Object.assign(Mixed.prototype, {
  triple() {
    return this.n * 3;
  },
});
for (const name of ["one", "two"]) {
  Object.defineProperty(Mixed.prototype, name, {
    get() {
      return `${name}${this.n}`;
    },
  });
}
often("mixed", i => [new Mixed().triple(), new Mixed().one, new Mixed().two].join());

class Late {
  n = 1;
}
const kept = new Late();
const readLater = object => object.later;
often("late: before", () => readLater(kept));
Late.prototype.later = "value";
often("late: a value", () => readLater(kept));
Object.defineProperty(Late.prototype, "later", { get: () => "getter", configurable: true });
often("late: a getter", () => readLater(kept));
Object.setPrototypeOf(Late.prototype, { later: "above", above: "above" });
often("late: link", () => [readLater(kept), kept.above].join());

console.log(lines.join("\n"));
