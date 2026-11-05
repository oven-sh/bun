// answers: with-library
// # A view over a buffer that may grow is born in another Structure than the views that the class makes otherwise, and that Structure never has the mark: its length moves.
// # Link said "stays as its class has made it" of every `new <View>(x)`. Now a view that is made over what may be a buffer has no such word, so nothing is held against it and nothing leans on it.
// # The program runs under the word of the door, which holds every such word of Link against the object and stops where it is false.
// # OPTIONS: testing=HoldsObjectsToStayingAsMade
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
function total(view: Int32Array, buffer: ArrayBuffer, bytes: number): string { const n = view.length; buffer.resize(bytes); let sum = 0; let absent = 0; for (let at = 0; at < n; at++) { const element = view[at]; if (element === undefined) absent++; else sum += element; } return n + " " + sum + " " + absent + " " + view.length; }
for (const bytes of [24, 8, 0, 40]) { const buffer = new ArrayBuffer(24, { maxByteLength: 64 }); const view = new Int32Array(buffer); for (let at = 0; at < view.length; at++) view[at] = 3; report(total(view, buffer, bytes)); }
report("end");
