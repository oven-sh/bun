// The reference is `bun <file>`: a bundle has no dead zones, and the executable that `bun build --compile` makes without --aot reads undefined.
const seen = [];
const limit = JSON.parse("1");
const box = {
  toString() {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    let kind;
    try { kind = typeof late + ":" + (late.length + work); } catch (e) { kind = e.name; }
    seen.push(kind);
    return "box";
  },
};
let turns = 0;
let text = "";
for (;;) {
  if (turns === limit) break;
  turns++;
  text = "a" + box;
}
const late = ["a", "b"].join("-");
text = text + "b" + box;
console.log(seen.join(" "), String(text));
