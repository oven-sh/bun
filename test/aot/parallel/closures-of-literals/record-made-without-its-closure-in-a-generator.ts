type Options = { name: string; done?: () => number };
const kept: Options[] = [];
function keep(o: Options) { kept.push(o); return o; }
function* makes(k: number) { let n = k; yield keep({ name: "a", done: () => ++n }); }
function* leavesOut() { yield keep({ name: "b" }); }
const x = makes(1).next().value!, y = leavesOut().next().value!;
console.log(x.done?.(), x.done?.(), y.done?.(), kept.length);
