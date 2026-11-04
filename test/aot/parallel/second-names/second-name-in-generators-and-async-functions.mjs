// The loop stands in a generator or an async function: the frame is saved and comes back between the stores.
function* steps(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { k.n += i; yield acc.n; k = k; } return acc.n; }
function* withoutYieldInLoop(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { k.n += i; k = k; } yield acc.n; }
async function awaited(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { k.n += await i; k = k; } return acc.n; }
async function awaitedBehind(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { k.n += i; k = k; } await 0; return acc.n; }
function drained(generator) { let text = ""; for (;;) { const step = generator.next(); text += step.value + (step.done ? "." : ","); if (step.done) return text; } }
console.log(drained(steps(0)), drained(steps(4)), drained(withoutYieldInLoop(6)));
let last = ""; for (let r = 0; r < 300; r++) last = drained(steps(4)) + drained(withoutYieldInLoop(6));
console.log(last);
console.log(await awaited(0), await awaited(6), await awaitedBehind(6));
