// url.parse(), url.format() and url.resolve() of many strings, and of receivers that are no strings.
const url = require("node:url");
process.noDeprecation = true;
const inputs = [
  "http://user:pw@host.com:8080/p/a?x=1&y=2#h", "HTTP://Example.COM", "//host/path", "/path?query", "?only", "#hash", "", "mailto:a@b.c", "file:///C:/x y", "http://[::1]:3000/a", "http://a b/c", "javascript:alert(1)",
  "http://ex%41mple/%2F", "http://münchen.de/ä?ö=ü#ß", "  http://spaces.com/  ", "http://a.com/\t{x}|^`", "http://x.com/'single'\"double\"", "http://host:80:80/", "http://user@@host/", "http://-/", "x:y:z", "http://a.com/\u{1F600}", "http://a/\ud800x",
  "http://host?a=b?c", "http://host#a#b", "http:/one", "http:two", "..\\back\\slash", "https://a.b/c;d=e?f=g&f=h&i",
];
const lines = [];
const show = (label, make) => {
  try {
    lines.push(label + " " + JSON.stringify(make()));
  } catch (e) {
    lines.push(label + " " + e.constructor.name + " " + e.code);
  }
};
for (let round = 0; round < 40; round++) {
  lines.length = 0;
  for (const input of inputs) {
    show(input, () => ({ ...url.parse(input, true) }));
    show("format", () => url.format(url.parse(input)));
    show("slashes", () => url.parse(input, false, true).host);
    show("resolve", () => url.resolve("http://base.com/a/b?c", input));
  }
}
for (const other of [null, undefined, 5, {}, [], new String("http://a.b/c"), Symbol.iterator, true, 9n]) show(typeof other, () => ({ ...url.parse(other) }));
show("rope", () => ({ ...url.parse("http://" + "a".repeat(40) + ".com/" + inputs[0].slice(5)) }));
show("wide", () => ({ ...url.parse("http://wide.com/" + "あ".repeat(20)) }));
console.log(lines.join("\n"));
