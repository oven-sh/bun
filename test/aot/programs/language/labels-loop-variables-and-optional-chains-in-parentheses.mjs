// A loop with two labels continues to the outer one, loops store to variables named `using` and `async`, and an optional chain in parentheses is a tag and the callee of `new`.
// Plain Bun prints another output.
let turns = 0;
outer: inner: while (turns < 3) {
  turns++;
  continue outer;
}
console.log("continues to the outer of two labels:", turns);
let rounds = 0;
first: second: third: for (let i = 0; i < 4; i++) {
  rounds++;
  if (i % 2) continue first;
  continue second;
}
console.log("of three labels:", rounds);

var using;
for (using of [1, 2]);
console.log("a loop stores to a variable named using:", using);
var async;
async function walks() {
  for await (async of [3, 4]);
  return async;
}

const holder = {
  label: "holder",
  tag(strings, value) {
    return strings.join("|") + " " + value + " " + (this === holder ? "this is the holder" : typeof this);
  },
  Made: class {
    constructor(value) {
      this.value = value;
    }
  },
};
const nothing = null;
console.log("a tag:", (holder?.tag)`a${1}b`);
console.log("behind new:", new (holder?.Made)(5).value);
for (const run of [() => (nothing?.tag)`x`, () => new (nothing?.Made)()]) {
  try {
    run();
  } catch (error) {
    console.log("of nothing:", error.constructor.name);
  }
}
console.log("a loop stores to a variable named async:", await walks());
