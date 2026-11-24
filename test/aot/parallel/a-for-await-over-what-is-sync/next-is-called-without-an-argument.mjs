const out = []; let i = 0;
const it = { [Symbol.iterator]() { return this; }, next(...a) { out.push("n" + a.length); return { done: i === 2, value: i++ }; } };
async function main() { for await (const x of it) out.push(x); out.push("end"); console.log(out.join(" ")); }
main();
