function read(text: string, base?: string) {
  const url = base === undefined ? new URL(text) : new URL(text, base);
  const query = url.searchParams;
  const lines = [url.href, url.pathname, url.search, String(query.size)];
  lines.push("a=" + query.get("a"), "has b " + query.has("b"), "all a " + query.getAll("a").join("|"), "none " + query.get("none"));
  lines.push("keys " + [...query.keys()].join("|"), "values " + [...query.values()].join("|"), "pairs " + [...query.entries()].map(pair => pair.join(">")).join("|"));
  const each: string[] = [];
  query.forEach((value, key) => each.push(key + ":" + value));
  lines.push("each " + each.join("|"), "text " + query.toString());
  return lines.join("\n  ");
}
const texts = [
  "http://host.example/path",
  "http://host.example/path?",
  "http://host.example/path?a=1",
  "http://host.example/path?a=1&b=2&a=3",
  "http://host.example/path?a&b=&=c&&",
  "http://host.example/path?a=one+two&b=%41%2b%zz&c=caf%C3%A9",
  "http://host.example/path?a=1#part?b=2",
  "http://host.example:8080/a/../b/./c?a=%26&b=%3D",
  "http://host.example/path?a=é&b=€",
];
for (const text of texts) console.log(read(text));
console.log(read("/below?a=5", "http://host.example/over/there?a=1"));
console.log(read("?a=6&b", "http://host.example/over/there?a=1"));
console.log(read("other", "http://host.example/over/there"));
for (const bad of ["", "path", "http://", "http://host example/"]) {
  try {
    console.log(new URL(bad).href);
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
const changed = new URL("http://host.example/path?a=1&b=2");
changed.searchParams.set("a", "9");
changed.searchParams.append("c", "x y");
changed.searchParams.delete("b");
console.log(changed.href, changed.search, changed.searchParams.get("a"));
