// RUN: lower
// CHECK-LABEL: function {{*}}name="sloppy"
// CHECK-NOT: ReturnCall
// CHECK: Return [[value]]
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="strict"
// CHECK: ReturnCall

function sloppy(g) {
  return g();
}

class Holder {
  static strict(g) {
    return g();
  }
}

module.exports = { sloppy, Holder };
