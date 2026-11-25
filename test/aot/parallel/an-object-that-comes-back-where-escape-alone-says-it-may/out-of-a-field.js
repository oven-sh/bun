const box = { v: "first" };
const list = JSON.parse("[]");
list[0] = box;
list[0].v = new URL("http://made.up/a?b=" + (process.argv[2] || "seven"));
console.log(box.v);
