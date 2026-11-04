// `new Readable({ read() {} })`: one function reads `options.read` of every caller's literal, each with a function of its own that is made at that read.
function Reader(options) {
  let size = 0;
  for (let k = 0; k < 3; k++) size += k;
  this.size = size;
  if (options) {
    const { read, close } = options;
    if (typeof read === "function") this.read = read;
    if (typeof close === "function") this.close = close;
  }
}

const first = i =>
  new Reader({
    read() {
      return "first" + i;
    },
  });
const second = i =>
  new Reader({
    read() {
      return "second" + i;
    },
    close() {
      return "closed" + i;
    },
  });
const third = i =>
  new Reader({
    close() {
      return "only closed" + i;
    },
  });
const asynchronous = i =>
  new Reader({
    async read() {
      return "later" + i;
    },
  });
const plain = i =>
  new Reader({
    read: function named() {
      return new.target ? "constructed" : "plain" + i;
    },
  });
const arrow = i => new Reader({ read: () => "arrow" + i });
const generator = i =>
  new Reader({
    *read() {
      yield "yielded" + i;
    },
  });
const withoutCaptures = () =>
  new Reader({
    read() {
      return "nothing captured";
    },
  });
const otherWithoutCaptures = () =>
  new Reader({
    read() {
      return "nothing here either";
    },
    close() {
      return 0;
    },
  });
const notFunctions = i => new Reader({ read: i, close: null });

const makers = [
  first,
  second,
  third,
  asynchronous,
  plain,
  arrow,
  generator,
  withoutCaptures,
  otherWithoutCaptures,
  notFunctions,
];

function describe(reader) {
  const read = reader.read;
  if (read === undefined) return "no read, " + (reader.close ? reader.close() : "no close");
  const answer = read();
  const text =
    typeof answer === "string" ? answer : typeof answer.next === "function" ? answer.next().value : "a promise";
  return [text, read.name, read.length, typeof read.prototype, reader.close ? reader.close() : "-"].join();
}

let lines = [];
for (let round = 0; round < 400; round++) {
  for (const make of makers) {
    const line = describe(make(round & 3));
    if (round < 4) lines.push(line);
  }
}
console.log(lines.join("\n"));

// Each evaluation of a literal makes a function of its own, and a second read finds the one that the first made.
function twice(options) {
  let n = 0;
  for (let k = 0; k < 2; k++) n += k;
  return options.read === options.read && n === 1;
}
const literals = [];
for (let i = 0; i < 6; i++)
  literals.push(
    i & 1
      ? {
          read() {
            return 1;
          },
        }
      : {
          read() {
            return 2;
          },
          close() {},
        },
  );
console.log(
  literals.every(twice),
  literals[1].read === literals[3].read,
  literals[0].read === literals[2].read,
  literals[1].read() + literals[0].read(),
);
literals[1].read.mark = "kept";
console.log(literals[1].read.mark, literals[3].read.mark, Object.keys(literals[0]).join(), JSON.stringify(literals[1]));
console.log(
  new (plain(0).read)() instanceof Object,
  (() => {
    try {
      new (first(0).read)();
    } catch (e) {
      return e instanceof TypeError;
    }
  })(),
);
