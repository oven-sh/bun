// the list that split() makes of written texts is changed, and made again
function colors() { return "red,green,blue".split(","); }
function edges() { return [",a,,b,".split(","), "abc".split("x"), "".split(","), "a--b".split("--"), "a,b".split(",", 1), "ab".split("")]; }
function deed() {
  const first = colors();
  const second = colors();
  first.push("black");
  first[0] = 1.5;
  second.length = 1;
  return [first === second, first.join("|"), second.join("|"), colors().join("|"), Array.isArray(first), Object.keys(colors()).join()].join(" ");
}
console.log(deed());
for (let turn = 0; turn < 3; turn++)
  console.log(deed(), JSON.stringify(edges()));
