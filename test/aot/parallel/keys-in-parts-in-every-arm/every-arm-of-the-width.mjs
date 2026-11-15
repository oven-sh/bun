const w = JSON.parse('{"head":"xyz-prefix","wide":"xyz-prefix \\u03b1","tail":"-0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz","beta":"\\u03b2"}');
function join(left, right) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const held = [left + right];
  return held[work - 1];
}
function turn(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const cut = w.wide.substring(0, 10);
  const narrowTable = new Map(), wideTable = new Map();
  narrowTable.set(join(w.head, w.tail), n);
  wideTable.set(join(cut, w.tail), n + 1);
  wideTable.set(join(w.beta, w.tail), n + 2);
  const wideRope = join(cut, w.tail), narrowRope = join(w.head, w.tail);
  const greek = join(w.beta, w.tail), absent = join(w.beta + w.beta, w.tail);
  const around = w.beta + wideRope + w.beta, inside = w.head + narrowRope + w.head, twice = wideRope + wideRope;
  const said = [narrowTable.get(wideRope), narrowTable.has(wideRope), wideTable.get(narrowRope), wideTable.get(narrowRope)];
  said.push(wideTable.get(greek), String(wideTable.get(absent)), wideTable.has(absent), narrowTable.has(greek));
  wideTable.set(absent, n + 3);
  said.push(wideTable.get(join(w.beta + w.beta, w.tail)), wideTable.size);
  said.push(wideRope.length, wideRope.charCodeAt(9), wideRope === narrowRope, around.length, around.charCodeAt(0), around.charCodeAt(1), around.charCodeAt(84));
  said.push(inside.length, inside.lastIndexOf("xyz"), twice.length, twice.charCodeAt(83), greek.charCodeAt(0), absent.length);
  return said.join(" ");
}
let last = "";
for (let n = 0; n < 300; n++) last = turn(n);
console.log(last);
