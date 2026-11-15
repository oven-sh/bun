// A Cookie shares its native part with the map from then on. The members of an object are read by name, and what they hold is converted.
const map = new Bun.CookieMap();
const cookie = new Bun.Cookie("shared", "before");
map.set(cookie);
cookie.value = "after";
console.log(`${map.get("shared")} ${map.set()} ${map.size}`);
const read = [];
const options = new Proxy(
  { name: "made", value: "of members", path: "/there" },
  {
    get(target, key) {
      read.push(String(key));
      return target[key];
    },
  },
);
map.set(options);
console.log(`${map.get("made")} | ${read.join(" ")}`);
for (const operands of [
  ["only a name"],
  ["a", "b", 5],
  ["bad name;", "b"],
  [{}],
  [{ name: "a", value: "b", sameSite: "never" }],
  [5, 6],
]) {
  try {
    console.log(`${map.set(...operands)} ${map.size}`);
  } catch (error) {
    console.log(`${error.name}: ${error.message}`);
  }
}
