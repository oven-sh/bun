async function wait(i) { const o = { lid: i }; await null; o.lid++; await Promise.resolve(); return o.lid; }
function* steps(i) { const o = { lid: i }; yield o.lid; o.lid += 10; yield o.lid; return o; }
async function* both(i) { const o = [i]; yield o.length; await null; o.push(1); yield o.length; }
const g = steps(1); const seen = [g.next().value, g.next().value, g.next().value.lid];
const more = []; for await (const n of both(3)) more.push(n);
console.log(await wait(1), seen.join(), more.join());
