// The length of a field that holds one of up to four strings written in the program. The compiler may work it out from the number of the string.
const lines = [];
const rising = [{ s: "a" }, { s: "bb" }, { s: "ccc" }, { s: "dddd" }];
const falling = [{ t: "dddddd" }, { t: "ccc" }, { t: "bb" }, { t: "" }];
const twoAlike = [{ u: "one" }, { u: "two" }, { u: "three" }, { u: "fourth" }];
const allAlike = [{ v: "ab" }, { v: "cd" }, { v: "ef" }, { v: "gh" }];
const three = [{ w: "p" }, { w: "qq" }, { w: "rrrr" }];
const wide = [{ x: "\u00e9" }, { x: "\u4e2d\u6587" }, { x: "\ud83d\ude00!" }, { x: "plain" }];
const veryLong = [{ y: "s" }, { y: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }, { y: "mm" }, { y: "lll" }];
// Other strings are written between these four, so their numbers may lie far apart.
const apart = [{ z: "first of four" }];
const between = ["filler one", "filler two", "filler three", "filler four", "filler five", "filler six", "filler seven", "filler eight", "filler nine"];
apart.push({ z: "second" });
lines.push(between.join().length);
apart.push({ z: "the third one" }, { z: "4" });
function lengths(i) {
  return [
    rising[i & 3].s.length, falling[i & 3].t.length, twoAlike[i & 3].u.length, allAlike[i & 3].v.length, three[i % 3].w.length,
    wide[i & 3].x.length, veryLong[i & 3].y.length, apart[i & 3].z.length,
  ];
}
const functions = [lengths];
for (let i = 0; i < 12; i++) lines.push(functions[0](i).join(" "));
console.log(lines.join("\n"));
