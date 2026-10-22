function check(actual, expected) {
  if (actual !== expected) throw new Error("bad value");
}
function atMost(value) {
  return Number(value) <= 42;
}
for (let i = 0; i < 2; ++i) check(atMost("Hello"), false);
console.log("done");
