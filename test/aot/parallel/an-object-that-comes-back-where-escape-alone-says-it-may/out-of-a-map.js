const held = new Map([["a", "first"]]);
const list = JSON.parse("[]");
list[0] = held;
list[0].set("a", new URL("http://made.up/a?b=" + (process.argv[2] || "seven")));
console.log(held.get("a"));
