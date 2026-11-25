// answers: with-library
// # A store into a list under a written number below zero is no store of an element: the test of the position folds to no, and the way that would store in line is code that nothing enters.
// # Where the build validates, the machine's builder holds each store against the loads that still stand at its address; the store in that dead code stands eight bytes in front of the elements, where the length lies. It must not stop the build.
// # OPTIONS: check=Validate
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
function put(list, key, value) { list[key] = value; }
function fill(list, n) { for (let i = 0; i < n; i++) list[i] = i * 2; }
const list = [];
fill(list, 4);
report(list.length);
put(list, -1, 100);
report(list.length);
report(list[-1]);
put(list, -2, list.length);
report(list[-2]);
put(list, 4, 8);
report(list.length);
report(Object.keys(list).join());
report(list[4]);
report("end");
