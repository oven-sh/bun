function print(y) { console.log(y); }
function show(x) { print(x); }
const list = JSON.parse("[]");
list[0] = new Map([["a", new URL("http://made.up/a?b=" + (process.argv[2] || "seven"))]]);
show("first");
print(2);
list.forEach(show);
