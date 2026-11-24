// The program makes every list itself, so the analysis knows what each holds, in which storage, and that nothing else writes it: tests are answered ahead of time, arms are cut and loops are copied on that knowledge.
// Among the lists are some with an undefined element, with a hole, of another storage, or read outside. At the end the shell runs the same text itself: every answer is the same.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
report(sum([1.5, 2.5]));
report(sum([1.5, undefined]));
report(sum([1, 2]));
report(sum([]));
function sumOfLiteral(x) { const list = [1.5, x]; let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
report(sumOfLiteral(2.5));
report(sumOfLiteral());
report(sumOfLiteral(2));
function sumOfRest(...given) { let s = 0; for (let i = 0; i < given.length; i++) s += given[i]; return s; }
report(sumOfRest(1.5, 2.5));
report(sumOfRest(1.5, undefined, 2));
report(sumOfRest());
function sumWithHoles(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
report(sumWithHoles([1.5, , 2.5]));
report(sumWithHoles([1.5, 2.5]));
function sumDown(list) { let s = 0; for (let i = list.length - 1; i >= 0; i--) s += list[i]; return s; }
report(sumDown([1.5, 2.5]));
report(sumDown([undefined, 1.5]));
function sumPushed(n, odd) { const list = []; for (let i = 0; i < n; i++) list.push(i === 2 ? odd : i + 0.5); let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
report(sumPushed(4, 2.5));
report(sumPushed(4, undefined));
report(sumPushed(2, undefined));
function sumFilled(n) { const list = new Array(3); for (let i = 0; i < n; i++) list[i] = i + 0.5; let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
report(sumFilled(3));
report(sumFilled(2));
function sumPastTheEnd(list) { let s = 0; for (let i = 0; i <= list.length; i++) s += list[i]; return s; }
report(sumPastTheEnd([1.5, 2.5]));
function sumBefore(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i - 1]; return s; }
report(sumBefore([1.5, 2.5]));
function countPresent(list) { let n = 0; for (let i = 0; i < list.length; i++) if (i in list) n++; return n; }
report(countPresent([1.5, , 2.5]));
report(countPresent([1.5, undefined]));
report(countPresent([1, 2, 3]));
report("end");
