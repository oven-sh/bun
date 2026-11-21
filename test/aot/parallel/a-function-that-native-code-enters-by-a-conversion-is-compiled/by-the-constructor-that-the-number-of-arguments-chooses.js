// With a third argument, `undefined` too, URLPattern converts the second to a string. Without one it reads the second as its options.
let converted = 1;
let read = 1;
let readSecond = 1;
const base = { toString() { converted = "text"; return "http://h"; } };
const options = { get ignoreCase() { read = "text"; return true; } };
const second = { get ignoreCase() { readSecond = "text"; return true; } };
console.log(new URLPattern("/a", base, undefined).hostname, typeof converted);
console.log(new URLPattern("/a", "http://h", options).test("http://h/A"), typeof read);
console.log(new URLPattern("http://h/a", second).test("http://h/A"), typeof readSecond);
