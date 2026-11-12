// A name, a name with options, or options that hold the name.
const map = new Bun.CookieMap("a=1; b=2; c=3");
map.delete("a");
map.delete("b", { path: "/made", domain: "made.example" });
map.delete({ name: "c" });
console.log(`${map.size} ${map.toSetCookieHeaders().length}`);
console.log(
  map
    .toSetCookieHeaders()
    .map(header => header.replace(/Expires=[^;]+/, "Expires=then"))
    .join(" | "),
);
for (const operands of [[], ["a", 5], [{}], [5], [{ name: 5 }]]) {
  try {
    console.log(`${map.delete(...operands)}`);
  } catch (error) {
    console.log(`${error.name}: ${error.message}`);
  }
}
