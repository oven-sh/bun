// A URL or a URLSearchParams that is only read, held in a `const` of a block in the module's own code (a script that works in a loop at the top of its file). What a function of the module reads, what the file itself declares and what an await lies across come out the same.
const lines: string[] = [];
const texts = ["page=2&limit=10&sort=old", "", "a=1&a=2&b=%20x", "q=caf%C3%A9+au+lait&empty=&=novalue", "page=3"];
const addresses = ["https://user:pass@example.com:8080/a/b.html?x=1&y=two#part", "http://example.com", "file:///tmp/x%20y", "https://example.com/?q=1"];

for (const text of texts) {
  const query = new URLSearchParams(text);
  const found: Record<string, string> = Object.create(null);
  for (const [name, value] of query) found[name] = value;
  lines.push(JSON.stringify([query.size, query.toString(), query.get("a"), query.has("page"), found]));
}

for (let i = 0; i < addresses.length; i++) {
  const url = new URL(addresses[i]!);
  lines.push([url.protocol, url.host, url.pathname, url.search, url.hash, url.href].join(" | "));
  const parameters = url.searchParams;
  lines.push(String(parameters.get("x")) + " " + parameters.has("q") + " " + parameters.size);
}

block: {
  const url = new URL("https://example.com/in/a/block?k=v");
  if (url.pathname.length > 100) break block;
  lines.push(url.pathname + url.search);
}

{
  const captured = new URL("https://example.com/captured?c=1");
  const later = () => captured.pathname + captured.search;
  lines.push(later());
  const changed = new URL("https://example.com/changed");
  changed.pathname = "/other";
  lines.push(changed.href);
  const kept = new URLSearchParams("k=1");
  const holder = { kept };
  holder.kept.append("l", "2");
  lines.push(kept.toString() + " " + kept.size);
}

for (const text of ["w=1&x=2", "y=3"]) {
  const query = new URLSearchParams(text);
  const before = query.size;
  await Promise.resolve();
  lines.push(before + " " + query.toString() + " " + query.get("x"));
}

try {
  for (const address of ["https://example.com/fine", "not an address"]) {
    const url = new URL(address);
    lines.push(url.pathname);
  }
} catch (error) {
  lines.push("throws " + (error as Error).constructor.name);
}

const ofTheFile = new URL("https://example.com/of/the/file?f=1");
function readsIt() {
  return ofTheFile.pathname;
}
lines.push(readsIt() + ofTheFile.search);
export const exported = new URLSearchParams("e=1");
lines.push(exported.toString());

console.log(lines.join("\n"));
