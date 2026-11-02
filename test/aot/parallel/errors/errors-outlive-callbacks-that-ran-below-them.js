// An error outlives the callbacks that ran when it was made: they got a displayName through a value that nobody follows and were let go, and a collection came before anybody read the stack.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const names = stack =>
  stack
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/ ?\(.*\)$/, ""),
    )
    .filter(name => !name.includes("/") && !name.includes("\\"))
    .join(" < ");

const errors = [];
function step(visit, value) {
  return visit(value) + 1;
}
function take(k, name) {
  const visit = handedBack(function visit(value) {
    errors.push(new Error("e" + value + k));
    return value + k;
  });
  const each = handedBack(function each(value) {
    return step(visit, value) + 1;
  });
  const sum = [1, 2].map(each).length;
  if (name) {
    handedBack(visit).displayName = name;
    handedBack(each).displayName = name + " for each";
  }
  return sum + 1;
}
let sum = 0;
for (let i = 0; i < 300; i++) sum += take(i, i % 3 ? "named " + (i % 3) : "");
Bun.gc(true);
// What takes the place of the callbacks.
const filler = [];
for (let i = 0; i < 20000; i++) filler.push({ i, text: "t" + i });
Bun.gc(true);
const seen = new Map();
for (const error of errors) {
  const line = names(error.stack);
  seen.set(line, (seen.get(line) ?? 0) + 1);
}
for (const [line, count] of [...seen].sort()) console.log(count, "x", line);
console.log(sum, filler.length);

// One that is thrown, caught and read behind a collection.
function fails(k) {
  const visit = handedBack(function visit(value) {
    return value.nothing.here + k;
  });
  try {
    return [undefined].map(visit).length + 1;
  } catch (error) {
    handedBack(visit).displayName = "failed " + k;
    return error;
  }
}
const failures = [fails(1), fails(2)];
Bun.gc(true);
for (const error of failures) console.log(names(error.stack));
