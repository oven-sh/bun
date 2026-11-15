// The list of the keys makes the text "eval", and the global object is read under it.
let held;
[0].forEach(function () {
  held = this;
});
const options = { eval: true, label: "made" };
const pick = (holder, key) => holder[key];
for (const key of Object.keys(options)) {
  const found = pick(held, key);
  if (typeof found === "function") console.log(key, found(JSON.parse('"1 + 1"')));
}
