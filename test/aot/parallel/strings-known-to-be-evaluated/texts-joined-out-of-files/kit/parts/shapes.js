var hidden = /^h/.test("hide");
function area(wide, high) {
  return hidden ? wide * high : -1;
}
function ring(outer) {
  outer_: for (var at = 0; at < 9; at++) {
    for (var k = 0; k < 9; k++) if (at * k === outer) break outer_;
  }
  return add(at) + at * 2;
}
