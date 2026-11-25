// The program makes every list itself, so the analysis knows what each holds, in which storage, and that nothing else writes it: tests are answered ahead of time, arms are cut and loops are copied on that knowledge.
// Among the lists are some with an undefined element, with a hole, of another storage, or read outside. At the end the shell runs the same text itself: every answer is the same.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function countDefined(list) { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] !== undefined) n++; return n; }
report(countDefined([1.5, undefined, 2.5]));
report(countDefined([1.5, , 2.5]));
report(countDefined([1.5]));
function cut(list) { let s = 0; for (let i = 0; i < list.length; i++) { if (list[i] < 0) list.length = i; else s += list[i]; } return s; }
report(cut([1.5, -1, 2.5]));
report(cut([1.5, 2.5]));
function doubleInPlace(list) { for (let i = 0; i < list.length; i++) list[i] = list[i] * 2; return list[0] + list[list.length - 1]; }
report(doubleInPlace([1.5, 2.5]));
report(doubleInPlace([1.5, undefined]));
report(doubleInPlace([1, 1073741824]));
function blank(list, at) { let s = 0; for (let i = 0; i < list.length; i++) { if (i === at) list[i + 1] = undefined; s += list[i]; } return s; }
report(blank([1.5, 2.5, 3.5], 0));
report(blank([1.5, 2.5, 3.5], 5));
report(blank([1.5, 2.5], 1));
function joined(list) { let s = ""; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
report(joined([1.5, undefined, "x"]));
report(joined(["a", "b"]));
report(joined([1.5, , null]));
function sumOfRows(rows) { let s = 0; for (let i = 0; i < rows.length; i++) for (let j = 0; j < rows[i].length; j++) s += rows[i][j]; return s; }
report(sumOfRows([[1.5, 2.5], [1, 2]]));
report(sumOfRows([[1.5], [undefined]]));
report(sumOfRows([[], [1.5, , 2.5]]));
function sumOfFields(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].x; return s; }
report(sumOfFields([{ x: 1.5 }, { x: 2.5 }]));
report(sumOfFields([{ x: 1.5 }, { y: 2.5 }]));
report(sumOfFields([{ x: 1.5 }, { x: undefined }]));
function sumOfBoth(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] + b[i]; return s; }
report(sumOfBoth([1.5, 2.5], [1, 2]));
report(sumOfBoth([1.5, 2.5], [1.5]));
report(sumOfBoth([1.5], [undefined, 2]));
function largest(list) { let m = list[0]; for (let i = 1; i < list.length; i++) if (list[i] > m) m = list[i]; return m; }
report(largest([1.5, 3.5, 2.5]));
report(largest([1.5, undefined, 2.5]));
report(largest([]));
report("end");
