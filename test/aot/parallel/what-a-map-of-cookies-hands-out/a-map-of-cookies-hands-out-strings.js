// get answers a string or null, has a boolean, and the headers of what was changed are strings in a new array.
const map = new Bun.CookieMap("first=1; second=two");
console.log(`${map.get("first")} ${map.get("none")} ${map.get()} ${map.has("second")} ${map.has("none")} ${map.size}`);
map.set("third", "3");
map.set("fourth", "4", { path: "/made", httpOnly: true, sameSite: "strict", maxAge: 5 });
map.delete("first");
const headers = map.toSetCookieHeaders();
console.log(
  `${Array.isArray(headers)} ${headers.length} ${headers.every(header => typeof header === "string")} ${map.toSetCookieHeaders() === headers}`,
);
console.log(headers.join(" | "));
console.log(`${map.get("first")} ${map.get("third")} ${map.size} ${JSON.stringify(map)}`);
