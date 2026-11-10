// Under: --aot-testing=CheckProofsAtRunTime: what is proven is asked again at run time
// Under: --aot-testing=FailGuesses: every guess fails
const meter = { scale: 3, bias: 0, run(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i] * this.scale + this.bias; return sum; } };
globalThis.madeUpMeter = meter;
const subject = { scale: 2, bias: 1, extra: true, run: meter.run };
const list = []; for (let i = 0; i < 1000; i++) list.push(i % 7); let total = 0; for (let turn = 0; turn < 5 + process.argv.length; turn++) total += subject.run(list); console.log(total / (5 + process.argv.length));
