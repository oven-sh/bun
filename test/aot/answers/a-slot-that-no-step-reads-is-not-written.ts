// answers: with-library
// # The allocator gives a slot to a value that it lets go of while the value's range goes on, and the store stands behind the definition.
// # Where no way that follows asks for the value again, no step reads the slot: here the start of the line, which each laid-out turn of the loop
// # hands on unchanged and defines anew. Such a slot is not written.
// # RUN(SLOTS): allocate f2:Body mechanisms=all
// # REQUIRES(SLOTS): x86_64 as-written
// # SLOTS: isReadByNoStep
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function isLineBreak(ch: number): boolean { return ch === 10 || ch === 13 || ch === 8232 || ch === 8233; }
function computeLineStarts(text: string): number[] { const result: number[] = []; let pos = 0; let lineStart = 0; while (pos < text.length) { const ch = text.charCodeAt(pos); pos++; switch (ch) { case 13: if (text.charCodeAt(pos) === 10) pos++; case 10: result.push(lineStart); lineStart = pos; break; default: if (ch > 127 && isLineBreak(ch)) { result.push(lineStart); lineStart = pos; } break; } } result.push(lineStart); return result; }
(globalThis as any).kept = [computeLineStarts];
const text: string = JSON.parse('"one\\ntwo\\r\\nthree\\u2028four five six seven eight nine ten\\n"');
report([computeLineStarts(text).join(",")].join(" "));
report([computeLineStarts("").join(",")].join(" "));
report([computeLineStarts("\n").join(",")].join(" "));
report([computeLineStarts("\r\n\r\n").join(",")].join(" "));
report([computeLineStarts("no break at all in this text of some length").join(",")].join(" "));
report([computeLineStarts("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr").join(",")].join(" "));
report([computeLineStarts("  x ").join(",")].join(" "));
report([computeLineStarts("twelve chars\r" + "x".repeat(40) + "\n" + "y".repeat(7)).join(",")].join(" "));
report("end");
