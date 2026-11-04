// The collector runs in every turn, while the enumerator and the position of the loop lie in the frame alone and the object is dropped by everybody else.
function walk(make) {
  let text = "";
  for (const k in make()) {
    Bun.gc(true);
    text += k + String(new Array(8).fill(k).length) + " ";
  }
  return text;
}
function deed() {
  return walk(() => { const o = {}; for (let i = 0; i < 12; i++) o["name" + i] = i; return o; });
}
console.log(deed());
for (let i = 0; i < 2; i++) console.log(walk(() => ({ a: 1 })), "|", deed());
