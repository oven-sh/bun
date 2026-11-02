// Joining two parts into a key throws where the result would be too long. The error is an ordinary one: it can be caught, it has a stack, and the program goes on.
let long = "x";
for (let i = 0; i < 30; i++) long += long;
const never = process.argv.length > 1000 ? "x" : "";
const unknown = new Function("f", "return f;" + never);
const holder = { xy: 1 };

function read(first, second) {
  return holder[`${first}${second}`];
}
function store(first, second) {
  holder[`${first}${second}`] = 2;
}
function has(first, second) {
  return `${first}${second}` in holder;
}

for (const use of [read, store, has]) {
  for (let round = 0; round < 3; round++) {
    // It has run with short parts before it meets the long ones.
    for (let i = 0; i < unknown(50); i++) use(unknown("x"), unknown("y"));
    try {
      use(unknown(long), unknown(long));
      console.log(use.name, "did not throw");
    } catch (error) {
      const frames = error.stack
        .split("\n")
        .slice(1, 3)
        .map(line =>
          line
            .trim()
            .replace(/ ?\(.*\)$/, "")
            .replace(/^at .*\.js:.*$/, "at module"),
        );
      console.log(use.name, error instanceof RangeError, error.message, frames.join(" < "));
    }
    console.log(use.name, use(unknown("x"), unknown("y")));
  }
}
