// answers: without-library
// # An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// # Here the tops of two heaps; the calls are written out.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
class Top { constructor(key, tag) { this.key = key; this.tag = tag; } }
class Heap { top = null; size = 0; constructor(key, tag) { this.top = new Top(key, tag); this.size = 1; } }
function step(h1, h2, largest) { if (h1.size <= 0 || h2.size <= 0 || h1.top === null || h2.top === null) return -1; const first = largest ? h1.top.key > h2.top.key : h1.top.key < h2.top.key; const h = first ? h1 : h2, n = first ? h1.size : h2.size; if (n > 0 && h.top !== null) return h.top.tag; return -2; }
report(step(new Heap(9, 11), new Heap(7, 22), false));
report(step(new Heap(9, 11), new Heap(7, 22), true));
report(step(new Heap(1, 11), new Heap(7, 22), false));
report(step(new Heap(1, 11), new Heap(7, 22), true));
report(step(new Heap(9, 11), new Heap(3, 22), false));
report(step(new Heap(9, 11), new Heap(3, 22), true));
report(step(new Heap(1, 11), new Heap(3, 22), false));
report(step(new Heap(1, 11), new Heap(3, 22), true));
report("end");
