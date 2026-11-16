// A counter that is stepped behind a comparison is kept as an integer in a register, with no test of the step. Here it passes either end of int32 and of uint32, reaches what a double no longer counts, steps by two, is compared with what is no integer or no number, and stands in a loop that tests it at the end.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function turns(from, to) { let n = 0; for (let i = from; i < to; i++) n++; return n; }
report(turns(0, 10));
report(turns(2147483640, 2147483650));
report(turns(-2147483650, -2147483640));
function up(from, to) { let i = from; while (i < to) i++; return i; }
report(up(2147483640, 2147483647));
report(up(2147483640, 2147483660));
report(up(4294967290, 4294967300));
function down(from, to) { let i = from; while (i > to) i--; return i; }
report(down(10, 0));
report(down(-2147483640, -2147483648));
report(down(-2147483640, -2147483660));
function byTwo(from, to) { let i = from; for (; i < to; i += 2); return i; }
report(byTwo(2147483640, 2147483647));
report(byTwo(0, 9));
function upTo(from, to) { let i = from; while (i <= to) i++; return i; }
report(upTo(2147483640, 2147483647));
function against(limit) { let n = 0; for (let i = 0; i < limit; i++) n += i; return n; }
report(against(10.5));
report(against("7"));
report(against(undefined));
report(against(NaN));
report(against(null));
report(against({ valueOf() { return 3; } }));
function atLeastOnce(n) { let i = 0; do { i++; } while (i < n); return i; }
report(atLeastOnce(5));
report(atLeastOnce(-1));
function nested(n, m) { let c = 0; for (let i = 0; i < n; i++) for (let j = i; j < m; j++) c += j; return c; }
report(nested(4, 6));
function pastWhatADoubleCounts(n) { let i = 9007199254740990; for (let c = 0; c < n; c++) i++; return i; }
report(pastWhatADoubleCounts(1));
report(pastWhatADoubleCounts(5));
function sumOf(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return sum; }
report(sumOf([1, 2, 3]));
report(sumOf([1.5, 2, -0.5]));
report(sumOf([1, "2", 3]));
report(sumOf([]));
function bounded(n) { let i = 0; let last = -1; while (i < n) { if (i > 5) last = i; i++; } return last; }
report(bounded(9));
function halves(n) { let i = n; let c = 0; while (i > 1) { i = i / 2; c++; } return c + i; }
report(halves(20));
function doubles(n) { let x = 1; for (let i = 0; i < n; i++) x = x * 2; return x; }
report(doubles(31));
report(doubles(70));
report("end");
