// node:url: the URL and URLSearchParams classes, paths to file URLs and back, the old parse, format and resolve, domains, urlToHttpOptions, and what is thrown for text that is no URL.
import url, { URL, URLSearchParams, fileURLToPath, pathToFileURL, domainToASCII, domainToUnicode, urlToHttpOptions } from "node:url";

process.noDeprecation = true;
const address = new URL("https://user:pass@example.com:8080/a/b/../c?x=1&y=two#part");
console.log([address.protocol, address.username, address.password, address.host, address.hostname, address.port, address.pathname, address.search, address.hash, address.origin].join(" "));
address.searchParams.append("z", "a b");
address.port = "443";
address.pathname = "/ü";
console.log(address.href, JSON.stringify(address), URL === globalThis.URL);
console.log(new URL("../up?q", "http://h/a/b/c").href, URL.canParse("nope"), URL.canParse("x:y"), new URL("HTTP://EXAMPLE.com:80/").href);
try {
  new URL("not a url");
} catch (error) {
  console.log(error.code, error.name);
}
const params = new URLSearchParams("a=1&b=2&a=3");
params.sort();
console.log(params.getAll("a").join(), params.has("b"), params.get("c"), params.toString(), [...params.keys()].join(), new URLSearchParams({ k: "v w" }).toString(), params.size);
console.log(fileURLToPath("file:///C:/tmp/a%20b.txt"), pathToFileURL("/tmp/a b#c.txt").href, fileURLToPath(new URL("file:///C:/x/y")));
try {
  fileURLToPath("http://example.com/");
} catch (error) {
  console.log(error.code);
}
const old = url.parse("http://user@host.example:81/p/a/t/h?query=string#hash", true);
console.log([old.protocol, old.auth, old.host, old.port, old.hostname, old.hash, old.search, old.pathname, old.path, old.query.query].join(" "));
console.log(url.format({ protocol: "https", hostname: "h.example", pathname: "/p", query: { a: 1, b: ["x", "y"] } }), url.format(new URL("https://h.example/p?q#f"), { fragment: false, search: false }));
console.log(url.resolve("/one/two/three", "four"), url.resolve("http://example.com/one", "/two"), url.resolve("http://example.com/", "//other.example/x"));
console.log(domainToASCII("español.com"), domainToUnicode("xn--espaol-zwa.com"), JSON.stringify(urlToHttpOptions(new URL("http://a:b@h.example:1/p?q"))));
