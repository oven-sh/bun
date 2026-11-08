// answers: without-library
// # An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// # Here the objects are lists, and the fields are elements; the calls are written out.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
function pick(left, right, key, exact) { if (!left[1] || !right[1] || !left[0] || !right[0]) return "none"; const flag = exact ? key === left[0] : key < right[0]; const side = flag ? left : right; const first = flag ? left[0] : right[0]; if (first && side[1]) return side[1]; return "leaf"; }
report(pick([1, 20], [5, 60, 7], 1, false));
report(pick([1, 20], [5, 60, 7], 1, true));
report(pick([1, 20], [5, 60, 7], 3, false));
report(pick([1, 20], [5, 60, 7], 3, true));
report(pick([1, 20], [5, 60, 7], 9, false));
report(pick([1, 20], [5, 60, 7], 9, true));
report("end");
