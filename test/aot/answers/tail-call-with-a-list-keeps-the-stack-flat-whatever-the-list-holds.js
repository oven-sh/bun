// answers: without-library
// # `return f.apply(t, list)` and `return Reflect.apply(f, t, list)` in strict code are tail calls, and the depth of a program may rest on that, WHATEVER THE LIST HOLDS: a hole, fractions with a hole,
// # nothing but holes, seventy elements with holes, array storage, a getter under an index, an element of another prototype. Each ring here is 100,000 turns deep.
// # The stub reads a hole of a pristine list as undefined. Every other list is read by an operation that returns, and the stub makes the call. A call out of C++ kept four frames a turn: RangeError at 9,177 turns.
// # f1 = hole, f2 = full, f7 = sparse
// # LIBRARY: own
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = CallList {{*}} tail
// # FORM-NEXT: ReturnCall
// # RUN(STUB): bytes f1:Body mechanisms=all
// # STUB-LABEL: unit f1:Body
// # STUB: Jump Stub CallWithArray.InTailPosition
// # RUN(FULL): bytes f2:Body mechanisms=all
// # FULL-LABEL: unit f2:Body
// # FULL: Jump Stub CallWithArray.InTailPosition
// # RUN(SPARSE): bytes f7:Body mechanisms=all
// # SPARSE-LABEL: unit f7:Body
// # SPARSE: Jump Stub CallWithArray.InTailPosition
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 18 of 18 of 18
// # CHECK-NEXT: exited with 0
function tell(deed) { try { report(deed()); } catch (error) { report(error.constructor.name); } }
let last = null;
function hole(n, absent, acc) { "use strict"; if (n === 0) return acc + (absent === undefined ? 0 : 1000); const list = [n - 1, , acc + 1]; last = list; return hole.apply(null, list); }
function full(n, middle, acc) { "use strict"; if (n === 0) return acc + middle; const list = [n - 1, 3, acc + 1]; last = list; return full.apply(null, list); }
function fractions(n, absent, acc) { "use strict"; if (n < 1) return acc + (absent === undefined ? 0 : 1000); const list = [n - 1, , acc + 0.25]; last = list; return fractions.apply(null, list); }
let turns = 0;
function nothingButHoles(first, second, third) { "use strict"; if (++turns === 100000) return String(first) + String(second) + String(third) + arguments.length; return nothingButHoles.apply(null, new Array(3)); }
function seventy(n) { "use strict"; const acc = arguments[69]; if (n === 0) return acc + (arguments[35] === undefined ? 0 : 1000) + arguments.length; const list = new Array(70); list[0] = n - 1; list[69] = acc + 1; return seventy.apply(null, list); }
function seventyFractions(n) { "use strict"; const acc = arguments[69]; if (n < 1) return acc + (arguments[35] === undefined ? 0 : 1000) + arguments.length; const list = [n - 1, 0.5]; list[69] = acc + 0.25; return seventyFractions.apply(null, list); }
function sparse(n, absent, acc) { "use strict"; if (n === 0) return acc + (absent === undefined ? 0 : 1000); const list = [n - 1]; list[200000] = 0; list.length = 3; list[2] = acc + 1; return sparse.apply(null, list); }
let reads = 0;
function computed(n, middle, acc) { "use strict"; if (n === 0) return acc + middle; const list = [n - 1, 0, acc + 1]; Object.defineProperty(list, 1, { get() { reads++; return 5; } }); return computed.apply(null, list); }
const parent = Object.create(Array.prototype);
parent[1] = 4;
function inherited(n, middle, acc) { "use strict"; if (n === 0) return acc + middle; const list = [n - 1, , acc + 1]; Object.setPrototypeOf(list, parent); return inherited.apply(null, list); }
function reflected(n, absent, acc) { "use strict"; if (n === 0) return acc + (absent === undefined ? 0 : 1000); const list = [n - 1, , acc + 1]; last = list; return Reflect.apply(reflected, null, list); }
function count() { return arguments.length; }
function second(first, other) { return other; }
function inside(callee, list) { "use strict"; const result = callee.apply(null, list); return result; }
tell(() => hole(100000, undefined, 0));
tell(() => full(100000, 3, 0));
tell(() => fractions(100000.5, undefined, 0.5));
tell(() => nothingButHoles(1, 2, 3));
tell(() => seventy.apply(null, [100000].concat(new Array(68), [0])));
tell(() => seventyFractions.apply(null, [100000.5].concat(new Array(68), [0.5])));
tell(() => sparse(100000, undefined, 0));
tell(() => computed(100000, 5, 0));
tell(() => reads);
tell(() => inherited(100000, 4, 0));
tell(() => reflected(100000, undefined, 0));
tell(() => last.length);
tell(() => inside(count, [1, , 3]));
tell(() => inside(second, [1, , 3]));
tell(() => inside(second, [1.5, , 3.5]));
tell(() => inside(count, new Array(9)));
tell(() => inside(second, new Array(9)));
report("end");
