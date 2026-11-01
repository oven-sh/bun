// RUN: lower
// DIAGNOSTIC: TS2364 1
// DIAGNOSTIC: TS2357 1
// DIAGNOSTIC: TS2779 1
// CHECK-NOT: PropSet

function call(o) {
  o() = 1;
}

function chain(a) {
  a?.b = 1;
}

function update(o) {
  o()++;
}

function valid(o) {
  o().p = 1;
  o().p++;
}

module.exports = { call, chain, update, valid };
