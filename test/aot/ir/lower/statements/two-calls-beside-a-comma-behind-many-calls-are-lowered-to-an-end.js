// The lowering asks the checker for types as it goes. To learn whether a call beside a comma is idle the checker checks its callee, by a walk that comes to the same calls again;
// what that walk wrote into the table of the far skip was undone by the walk around it, two entries named each other, and the build never ended.

// RUN: lower
// CHECK: function {{*}}name="fill"
// CHECK: function {{*}}name="gather"

// FILE: main.js
var isFirst = x => 0, isSecond = x => 0, fetchRows = () => [], place = 0, drain = () => {}, one = 0, two = 0, spare = 0;
var meter = { total: 0, add(v) { this.total += v } };
function fill(meter) {
  const mark = meter ? 1 : "s";
  meter.add(0); meter.add(0);
  meter.add(1); meter.add(1);
  meter.add(2); meter.add(2);
  meter.add(3); meter.add(3);
  meter.add(4); meter.add(4);
  meter.add(5); meter.add(5);
  meter.add(6); meter.add(6);
  meter.add(7); meter.add(7);
  meter.add(8); meter.add(8);
  meter.add(9); meter.add(9);
  meter.add(10); meter.add(10);
  meter.add(11); meter.add(11);
  meter.add(12); meter.add(12);
  meter.add(13); meter.add(13);
  meter.add(14); meter.add(14);
  meter.add(15); meter.add(15);
  meter.add(16); meter.add(16);
  meter.add(17); meter.add(17);
  meter.add(18); meter.add(18);
  meter.add(19); meter.add(19);
  meter.add(20); meter.add(20);
  meter.add(21); meter.add(21);
  meter.add(22); meter.add(22);
  meter.add(23); meter.add(23);
  meter.add(24); meter.add(24);
  meter.add(25); meter.add(25);
  meter.add(26); meter.add(26);
  meter.add(27); meter.add(27);
  meter.add(28); meter.add(28);
  meter.add(29); meter.add(29);
  meter.add(30); meter.add(30);
  return mark;
}
function gather(list) {
  let kept = [];
  let begin = () => {}, end = () => {};
  let current = null;
  for (let [key, item] of list.entries()) {
    let none = 0;
    if (isFirst(item));
    if (isSecond(item));
    if (item.kind && item.inner.kind);
    else if (item.kind && item.inner.kind) {
      let rows = current ? [] : fetchRows();
      {
        let row = rows[place];
        kept.push({ body: [row] });
        if (0) { continue }
        drain(), kept.push(1);
      }
    } else if (item.kind && item.inner.kind);
    else if (item.kind) {
      let left = 0, right = 0;
      if (one && Array.isArray(item));
      if (two && Array.isArray(item)) {
        let a = 0, b = 0, c = 0, d = 0, e = 0;
        if (0) kept.push(2);
      }
      {
        if (0) spare = null;
        begin(), end();
        continue;
      }
    }
  }
  return kept;
}
console.log(fill(meter), meter.total, gather([{ kind: "a", inner: { kind: "" } }, { kind: "", inner: {} }]).length);
