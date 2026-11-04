// COUNTER: operationAOTAppendIterable = 0
function* kinds(turns: number): Generator<unknown> { for (let i = 0; i < turns; i++) { yield i; yield i + 0.5; yield "s" + i; yield { i }; yield undefined; yield null; yield -0; yield NaN; yield [i]; yield 10n; } }
const all = [...kinds(3000)];
console.log(all.length, all.slice(0, 10).map(v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : JSON.stringify(v) ?? "undefined").join(" "), JSON.stringify(all[29993]), all.filter(v => typeof v === "number").length);
const integers = [...(function* () { for (let i = 0; i < 5; i++) yield i; })()], fractions = [0.5, ...(function* () { yield 1.5; yield 2; })()];
console.log(integers.join(), fractions.join());
