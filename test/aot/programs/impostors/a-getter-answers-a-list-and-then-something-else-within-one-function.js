function show(value) {
  if (Array.isArray(value)) return "[" + value.join() + "]";
  return typeof value + " " + String(value);
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function lengthThenFirst(row) {
  const count = row.tags.length;
  const first = row.tags[0];
  return count + ":" + first;
}

function sumOfTags(row) {
  let total = 0;
  for (let i = 0; i < row.tags.length; i++) total += row.tags[i];
  return total;
}

function pushThenRead(row) {
  row.tags.push(9);
  return row.tags[row.tags.length - 1];
}

function firstTwice(row) {
  return row.tags[0] + row.tags[0];
}

function widthTimesWidth(row) {
  return row.size.width * row.size.width;
}

const uses = { lengthThenFirst, sumOfTags, pushThenRead, firstTwice };

for (let i = 0; i < 2000; i++) {
  for (const use of Object.values(uses)) use({ tags: [1, 2, 3] });
  widthTimesWidth({ size: { width: i } });
}

function answering(...answers) {
  let reads = 0;
  return {
    get tags() {
      return answers[reads++ % answers.length];
    },
    get reads() {
      return reads;
    },
  };
}

const rows = {
  "a list every time": () => answering([1, 2, 3]),
  "a list and then a string": () => answering([1, 2, 3], "xyz"),
  "a string and then a list": () => answering("xyz", [1, 2, 3]),
  "a list and then a shorter list": () => answering([1, 2, 3], [7]),
  "a list and then an empty list": () => answering([1, 2, 3], []),
  "a list of numbers and then one of strings": () => answering([1, 2, 3], ["a", "b", "c"]),
  "a list of whole numbers and then one of fractions": () => answering([1, 2, 3], [0.5, 1.5, 2.5]),
  "a list and then a list with holes": () => answering([1, 2, 3], [, , 3]),
  "a list and then an array-like": () => answering([1, 2, 3], { 0: "zero", length: 1, push: () => 0 }),
  "a list and then a typed array": () => answering([1, 2, 3], new Uint8Array([200, 201, 202])),
  "a list and then undefined": () => answering([1, 2, 3], undefined),
  "a list and then a number": () => answering([1, 2, 3], 5),
  "a list and then arguments": () =>
    answering(
      [1, 2, 3],
      (function () {
        return arguments;
      })(4, 5, 6),
    ),
};

for (const [name, make] of Object.entries(rows)) {
  for (const [use, run] of Object.entries(uses)) {
    const row = make();
    attempt(name + ", " + use + ":", () => run(row));
    console.log(name + ", " + use + ": the getter ran", row.reads, "times");
  }
}

let sizeReads = 0;
const shifting = {
  get size() {
    sizeReads++;
    return sizeReads % 2 ? { width: 3 } : { width: "4", height: 1 };
  },
};
attempt("an object and then one of another shape:", () => widthTimesWidth(shifting));
attempt("and once more:", () => widthTimesWidth(shifting));
console.log("the getter ran", sizeReads, "times");
for (const [use, run] of Object.entries(uses)) attempt("honest again, " + use + ":", () => run({ tags: [1, 2, 3] }));
