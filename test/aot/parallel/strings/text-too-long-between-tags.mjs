let half = "x";
let most = "";
for (let i = 0; i < 30; i++) {
  most += half;
  half += half;
}
most += half; // half has 2 ** 30 characters, most 2 ** 31 - 1, as many as a text may have
const say = (name, make) => {
  let seen = "";
  for (let turn = 0; turn < 2; turn++) {
    try {
      seen += " " + make(half, half);
    } catch (error) {
      seen += " " + error.constructor.name;
    }
  }
  console.log(name + seen);
};
for (const name of ["anchor", "link", "fontcolor", "fontsize"]) {
  say(name, (a, b) => a[name](b));
  say(name + " of a short text", () => "x"[name](most));
  say(name + " by a short text", () => most[name]("x"));
}
for (const name of ["big", "blink", "bold", "fixed", "italics", "small", "strike", "sub", "sup"])
  say(name, () => most[name]());
say("what is asked", (a, b) => {
  const asked = [];
  try {
    String.prototype.anchor.call(
      { toString: () => (asked.push("text"), a) },
      { toString: () => (asked.push("name"), b) },
    );
  } catch (error) {
    asked.push(error.constructor.name);
  }
  return asked.join(", ");
});
console.log('a"b'.anchor('c"d'), "x".bold(), "丂".link("七"), "x".fontsize(7), "x".anchor());
console.log("under a gigabyte:", process.resourceUsage().maxRSS < 1024 * 1024);
