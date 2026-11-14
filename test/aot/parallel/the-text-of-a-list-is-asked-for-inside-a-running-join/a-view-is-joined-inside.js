function inner(list) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return list.join("-"); }
function once() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const list = [null, "x"]; const view = new Uint8Array([1, 2]); list[0] = { toString() { list[0] = "p"; return "<" + view.join("-") + inner(list) + ">"; } }; return list.join("+");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = once();
console.log(last);
