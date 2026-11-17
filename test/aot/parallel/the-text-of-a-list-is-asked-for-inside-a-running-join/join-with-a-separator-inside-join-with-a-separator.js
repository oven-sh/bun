function inner(list) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return list.join("-"); }
function once() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const list = [null, "x"];
  list[0] = { toString() { list[0] = "p"; return "<" + inner(list) + ">"; } };
  return list.join("+");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = once();
console.log(last);
