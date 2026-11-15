// Nothing, a string, an array of pairs or an object with strings. All else is refused.
const said = [];
const says = text => ({
  toString() {
    said.push(text);
    return text;
  },
});
for (const init of [
  undefined,
  null,
  "",
  "a=1; b=2",
  [
    ["a", "1"],
    ["b", says("two")],
  ],
  { a: "1", b: says("deux") },
  new Map([["a", "1"]]),
])
  console.log(JSON.stringify(new Bun.CookieMap(init)));
console.log(said.join(" "));
for (const init of [5, true, Symbol("made"), [["a"]], ["a=1"], [["a", "1", "more"]]]) {
  try {
    new Bun.CookieMap(init);
    console.log("made");
  } catch (error) {
    console.log(`${error.name}: ${error.message}`);
  }
}
try {
  Bun.CookieMap();
} catch (error) {
  console.log(error.name);
}
