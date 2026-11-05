// answers: without-library
// # What is computed from an element of a view may need more bits than the element has. It is held between the limits first and made narrow then, for every length of the view.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
function scaled(length: number): string { const pixels = new Uint8ClampedArray(length); for (let k = 0; k < length; k++) pixels[k] = k * 3; for (let k = 0; k < pixels.length; k++) pixels[k] = pixels[k]! * 300 - 40000; return pixels.join(); }
function limited(length: number): string { const shorts = new Int16Array(length); for (let k = 0; k < length; k++) shorts[k] = k * 2999; for (let k = 0; k < shorts.length; k++) shorts[k] = Math.max(-30000, Math.min(shorts[k]! * 70000, 30000)); return shorts.join(); }
for (const length of [0, 1, 7, 16, 33]) { report(scaled(length)); report(limited(length)); }
report("end");
