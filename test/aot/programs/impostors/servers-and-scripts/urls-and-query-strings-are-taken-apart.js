import querystring from "node:querystring";
import url, { fileURLToPath, pathToFileURL } from "node:url";

const address = new URL("https://ada:secret@example.com:8443/a/b%20c/../d?x=1&y=two&x=3#part");
console.log(address.protocol, address.username, address.password, address.host, address.hostname, address.port, address.pathname, address.search, address.hash, address.origin);
console.log(address.searchParams.get("x"), address.searchParams.getAll("x"), address.searchParams.has("z"), [...address.searchParams.keys()], address.searchParams.size);
address.searchParams.append("z", "a b&c");
address.searchParams.delete("y");
address.searchParams.sort();
address.port = "443";
address.hash = "";
console.log(address.href, String(address) === address.toString(), JSON.stringify({ address }));
console.log(new URL("../up?q", "http://h/a/b/c").href, new URL("//other/x", "https://h").href, URL.canParse("not a url"), URL.canParse("/x", "http://h"));
try {
  new URL("http://");
} catch (error) {
  console.log(error.name, error.code);
}
const parameters = new URLSearchParams({ a: "1", b: "ü ñ" });
parameters.set("c", [1, 2]);
console.log(parameters.toString(), Object.fromEntries(parameters), new URLSearchParams("?a=1&a=2&b").getAll("a"), new URLSearchParams([["k", "v"]]).get("k"));
parameters.forEach((value, name) => console.log(name, value));
console.log(querystring.parse("a=1&a=2&b=%20x&c"), querystring.stringify({ a: [1, 2], b: "x y", c: true }), querystring.escape("a&b"), querystring.unescape("%41"));
console.log(fileURLToPath("file:///C:/tmp/a%20b.txt"), pathToFileURL("/tmp/a b#c.txt").href, url.format({ protocol: "http", host: "h", pathname: "/p", query: { a: 1 } }));
const legacy = url.parse("http://user@h:81/p/q?a=1&b=2#f", true);
console.log(legacy.host, legacy.port, legacy.pathname, legacy.query.a, legacy.auth, legacy.hash, url.resolve("http://h/a/b", "../c"), url.domainToASCII("español.com"));
console.log(encodeURIComponent("a/b c?d"), decodeURIComponent("%E2%9C%93"), encodeURI("http://h/a b?c=d e"), import.meta.url.startsWith("file://"));
