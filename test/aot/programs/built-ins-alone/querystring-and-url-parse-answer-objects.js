import querystring from "node:querystring";
import url from "node:url";
const parsed = querystring.parse("first=1&second=two&first=3");
console.log(parsed.first.length, parsed.second.length, parsed.missing === undefined, querystring.stringify({ a: [1, 2], b: "c" }), url.parse("https://example.com/a?b=c").query, url.fileURLToPath("file:///a/b"));
