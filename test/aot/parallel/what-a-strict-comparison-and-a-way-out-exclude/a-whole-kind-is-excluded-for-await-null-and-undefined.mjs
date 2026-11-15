const it = () => ({ async *[Symbol.asyncIterator]() { for (const x of JSON.parse('[1,"a",null,{"k":2},0.5,true,false]')) yield x === 1 ? undefined : x; } });
let last, count = 0;
async function read(s) { for await (const x of s) { if (x === null || x === undefined) continue; last = x; count++; } return count; }

function show() { return [last].map(v => typeof v).join(); }

console.log(await read(it()), show(), count);
