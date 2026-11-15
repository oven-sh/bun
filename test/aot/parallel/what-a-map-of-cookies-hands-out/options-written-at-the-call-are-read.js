// Each call picks its row by what is written there, and what a literal holds is read by native code.
const map = new Bun.CookieMap();
map.set("a", "1", { path: "/made", domain: "made.example", httpOnly: true });
map.set("b", "2", null);
map.set("c", "3", undefined);
map.set({ name: "d", value: "4", secure: true, sameSite: "strict" });
map.set("e", "5");
console.log(map.toSetCookieHeaders().join(" | "));
let said = "no throw";
try {
  map.set("f", "6", 7);
} catch (error) {
  said = error.name;
}
console.log(`${said} ${map.has("f")}`);
said = "no throw";
try {
  map.delete("a", null);
} catch (error) {
  said = error.name;
}
console.log(`${said} ${map.has("a")}`);
said = "no throw";
try {
  map.delete("a", undefined);
} catch (error) {
  said = error.name;
}
console.log(`${said} ${map.has("a")}`);
let converted = "not converted";
map.set(
  "g",
  {
    toString() {
      converted = "converted";
      return "7";
    },
  },
  { path: "/g" },
);
console.log(`${converted} ${map.get("g")}`);
console.log(
  `${new Bun.CookieMap({ h: "8" }).get("h")} ${new Bun.CookieMap([["i", "9"]]).get("i")} ${map.get()} ${map.get(5)}`,
);
