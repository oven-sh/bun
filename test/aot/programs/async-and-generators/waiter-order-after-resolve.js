// A coroutine resolves the promise that an async function waits for and goes on: the waiter runs before whatever the coroutine awaits, steps or yields next,
// whether the coroutine is an async function or the body of an async generator, and whoever entered it. A drain of the job queue in between runs the waiter too.
import { drainMicrotasks } from "bun:jsc";
const lines = [];
function defer() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function* count(n) { for (let i = 0; i < n; i++) yield i; }
async function consume(label, source) { await null; for await (const x of source) lines.push(label + " consumer got " + x); }

{
    const { promise, resolve } = defer();
    async function waiter() { await promise; lines.push("await: waiter"); }
    async function resolver() { await null; resolve(1); await 0; lines.push("await: resolver goes on"); }
    await Promise.all([waiter(), resolver()]);
}
{
    const { promise, resolve } = defer();
    async function waiter() { await promise; lines.push("await of a promise: waiter"); }
    async function resolver() { await null; resolve(1); await Promise.resolve(0); lines.push("await of a promise: resolver goes on"); }
    await Promise.all([waiter(), resolver()]);
}
{
    const { promise, resolve } = defer();
    async function waiter() { await promise; lines.push("step: waiter"); }
    async function resolver() { await null; resolve(1); for await (const x of count(2)) lines.push("step: resolver got " + x); }
    await Promise.all([waiter(), resolver()]);
}
{
    const { promise, resolve } = defer();
    async function waiter() { await promise; lines.push("return: waiter"); }
    async function resolver() { await null; resolve(1); lines.push("return: resolver is over"); }
    await Promise.all([waiter(), resolver().then(() => lines.push("return: its promise is settled"))]);
}
{
    const { promise, resolve } = defer();
    async function waiter() { await promise; lines.push("drain: waiter"); }
    async function resolver() { await null; resolve(1); drainMicrotasks(); lines.push("drain: resolver goes on"); }
    await Promise.all([waiter(), resolver()]);
}
{
    const first = defer(), second = defer();
    async function firstWaiter() { await first.promise; lines.push("two waiters: first"); }
    async function secondWaiter() { await second.promise; lines.push("two waiters: second"); }
    async function resolver() { await null; first.resolve(1); second.resolve(2); await 0; lines.push("two waiters: resolver goes on"); }
    await Promise.all([firstWaiter(), secondWaiter(), resolver()]);
}
{
    const { promise, resolve } = defer();
    async function waiter() { await promise; lines.push("body after an await: waiter"); }
    async function* resolver() { await null; resolve(1); yield "a"; lines.push("body after an await: goes on"); yield "b"; }
    await Promise.all([waiter(), consume("body after an await:", resolver())]);
}
{
    const { promise, resolve } = defer();
    async function waiter() { await promise; lines.push("body in a step: waiter"); }
    async function* resolver() { yield "a"; resolve(1); yield "b"; lines.push("body in a step: goes on"); }
    await Promise.all([waiter(), consume("body in a step:", resolver())]);
}
{
    const { promise, resolve } = defer();
    async function waiter() { await promise; lines.push("chain: waiter"); }
    async function* inner() { yield "a"; resolve(1); yield "b"; }
    async function* outer() { yield* inner(); for await (const x of inner()) yield "again " + x; }
    await Promise.all([waiter(), consume("chain:", outer())]);
}
{
    const { promise, resolve } = defer();
    async function waiter() { await promise; lines.push("by hand: waiter"); }
    async function* resolver() { yield "a"; resolve(1); yield "b"; }
    async function byHand() { await null; const g = resolver(); for (let r = await g.next(); !r.done; r = await g.next()) lines.push("by hand: got " + r.value); }
    await Promise.all([waiter(), byHand()]);
}
console.log(lines.join("\n"));
