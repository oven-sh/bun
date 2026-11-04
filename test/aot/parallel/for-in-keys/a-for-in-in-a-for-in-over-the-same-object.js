// Two for-in loops over one object, one in the other: each has a position of its own, and the inner one reads under both keys.
function pairs(o) {
  let text = "";
  for (const k in o) {
    for (const j in o) text += k + j + "=" + (o[k] + o[j]) + " ";
    text += "/ ";
  }
  return text;
}
function deed() {
  const o = { a: 1, b: 2, c: 3 };
  return pairs(o);
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(pairs({ x: i }), "|", deed());
console.log(pairs({}), "|", pairs([5, 6]));
