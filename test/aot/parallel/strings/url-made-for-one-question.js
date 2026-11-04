// a URL is made of a text that arrives and asked one thing at once: plain texts, texts that the parser changes, texts that are no URL, what is no text
function pathOf(text) { return new URL(text).pathname; }
function searchOf(text) { return new URL(text).search; }
function valueOf(text, name) { return new URL(text).searchParams.get(name); }
function hasName(text, name) { return new URL(text).searchParams.has(name); }
function pathWithBase(text) { return new URL(text, "https://example.com/base/").pathname; }
function pathWithAnyBase(text, base) { return new URL(text, base).pathname; }
let calls = 0;
function next() { calls++; return "x"; }
function valueOfNext(text) { return new URL(text).searchParams.get(next()); }
function tell(f, ...rest) { try { return JSON.stringify(f(...rest)); } catch (e) { return e.name; } }
const texts = JSON.parse(`["https://example.com/a/b?x=1&y=2#top", "https://example.com", "https://example.com/a%20b/c d", "https://example.com/a/../b/./c", "HTTPS://EXAMPLE.COM/Up",
  "https://user:pw@example.com:8080/p?q", "https://example.com/?", "https://example.com/p?x=a+b&x=2&%78=3&empty=&flag", "https://example.com\\\\back\\\\slash", "https://exämple.com/ü?ö=ä",
  "file:///tmp/x", "mailto:a@b.c", "/only/a/path?x=9", "relative", "", "  https://example.com/spaces  ", "https://example.com/tab\\there"]`);
const odd = [undefined, null, 5, { toString() { return "https://example.com/from/object?x=o"; } }];
for (let turn = 0; turn < 2; turn++) {
  for (let i = 0; i < texts.length; i++)
    console.log(i, tell(pathOf, texts[i]), tell(searchOf, texts[i]), tell(valueOf, texts[i], "x"), tell(hasName, texts[i], "flag"), tell(pathWithBase, texts[i]), tell(pathWithAnyBase, texts[i], "https://other.example/dir/file"), tell(pathWithAnyBase, texts[i], "no base"), tell(valueOfNext, texts[i]), calls);
  for (let i = 0; i < odd.length; i++)
    console.log("odd", i, tell(pathOf, odd[i]), tell(valueOf, odd[i], "x"), tell(valueOf, texts[0], odd[i]));
}
