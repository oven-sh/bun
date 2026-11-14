// RUN: lower
// DIAGNOSTIC: TS2660 1
// CHECK-NOT: function

(function () {
  return super.x;
});
