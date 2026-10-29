#!/usr/bin/env python3
"""async-context.py <seed>: THE ASYNC CONTEXT: AsyncLocalStorage around producers, consumers and chains of async generators: what getStore() says at every step, and the ORDER of every step against other jobs (promise jobs, queueMicrotask, process.nextTick, timers). A random program of producers (plain yields, awaits of settled | pending | thenable | timer promises, yield*, try | finally, early return, throws), consumers (for await, by hand with next | return | throw, two consumers of one producer, next() called twice without awaiting) under nested run() | enterWith() | exit(), with bystanders that write down when they run. Needs the whole Bun (node:async_hooks)."""
import sys, random
seed = int(sys.argv[1]); R = random.Random(seed)
out = ['import { AsyncLocalStorage } from "node:async_hooks";', 'declare const process: any; declare const console: { log(...v: unknown[]): void }; declare function setTimeout(f: () => void, ms: number): unknown; declare function queueMicrotask(f: () => void): void;',
 'const als = new AsyncLocalStorage<string>(); const other = new AsyncLocalStorage<number>();', 'const log: string[] = []; let tick = 0;',
 'const at = (where: string): void => { log.push(++tick + " " + where + " [" + als.getStore() + "," + other.getStore() + "]"); };',
 'const pending = (ms: number, v: number): Promise<number> => new Promise(r => setTimeout(() => r(v), ms));',
 'const thenable = (v: number): PromiseLike<number> => ({ then(f: any) { at("then of a thenable " + v); f(v); return undefined as any; } });',
 'const bystanders = (name: string): void => { Promise.resolve().then(() => at("job of " + name)).then(() => at("second job of " + name)); queueMicrotask(() => at("microtask of " + name)); process.nextTick(() => at("tick of " + name)); };']
n = R.randrange(3, 6)
def awaited():
    k = R.randrange(7)
    return ['await 1', 'await Promise.resolve(2)', 'await pending(%d, 3)' % R.choice([0, 1, 2]), 'await thenable(4)', 'await null', 'await (async () => 5)()', 'await Promise.all([1, Promise.resolve(2)])'][k]
for i in range(n):
    body = ['at("p%d starts");' % i]
    for s in range(R.randrange(2, 6)):
        k = R.randrange(12)
        if k < 4: body.append('yield %d; at("p%d behind yield %d");' % (i * 10 + s, i, s))
        elif k < 6: body.append('%s; at("p%d behind await %d");' % (awaited(), i, s))
        elif k == 6 and i: body.append('yield* p%d(); at("p%d behind yield* %d");' % (R.randrange(i), i, s))
        elif k == 7 and i: body.append('for await (const v of p%d()) { at("p%d got " + v); yield v + 100; }' % (R.randrange(i), i))
        elif k == 8: body.append('yield als.run("in p%d", () => { at("p%d inside run"); return %d; });' % (i, i, i * 10 + s))
        elif k == 9: body.append('bystanders("p%d.%d");' % (i, s))
        elif k == 10: body.append('yield Promise.resolve(%d); at("p%d behind a yielded promise");' % (i * 10 + s, i))
        else: body.append('if (tick > %d) { at("p%d returns early"); return; }' % (R.randrange(20, 200), i))
    if R.random() < 0.3: body.append('throw new RangeError("p%d throws");' % i)
    text = ' '.join(body)
    if R.random() < 0.5: text = 'try { %s } finally { at("p%d finally"); %s }' % (text, i, R.choice(['', awaited() + '; at("p%d behind the await in finally");' % i]))
    out.append('async function* p%d(): AsyncGenerator<number> { %s }' % (i, text))
cons = []
for c in range(R.randrange(3, 7)):
    p = R.randrange(n); k = R.randrange(7)
    if k < 2: t = 'for await (const v of p%d()) { at("c%d got " + v); %s }' % (p, c, R.choice(['', awaited() + ';', 'bystanders("c%d");' % c, 'if (v % 10 === 1) break;']))
    elif k == 2: t = 'const g = p%d(); at("c%d made it"); let r = await g.next(); while (!r.done) { at("c%d got " + r.value); r = await g.next(); } at("c%d done");' % (p, c, c, c)
    elif k == 3: t = 'const g = p%d(); const two = [g.next(), g.next(), g.next()]; at("c%d asked thrice"); for (const r of await Promise.all(two)) at("c%d got " + r.value + " " + r.done); await g.return(undefined as any);' % (p, c, c)
    elif k == 4: t = 'const g = p%d(); at("c%d first " + (await g.next()).value); at("c%d return " + JSON.stringify(await g.return(7 as any))); at("c%d after " + JSON.stringify(await g.next()));' % (p, c, c, c)
    elif k == 5: t = 'const g = p%d(); at("c%d first " + (await g.next()).value); try { at("c%d throw " + JSON.stringify(await g.throw(new TypeError("thrown in")))); } catch (e) { at("c%d caught " + (e as Error).name); }' % (p, c, c, c)
    else: t = 'const g = p%d(); await als.run("first half c%d", async () => { at("c%d a " + (await g.next()).value); }); await als.run("second half c%d", async () => { at("c%d b " + (await g.next()).value); }); await g.return(undefined as any);' % (p, c, c, c, c)
    t = 'try { %s } catch (e) { at("c%d fails " + (e as Error).name); }' % (t, c)
    out.append('async function c%d(): Promise<void> { at("c%d starts"); %s at("c%d ends"); }' % (c, c, t, c)); cons.append(c)
main = []
for c in cons:
    k = R.randrange(6)
    call = 'c%d()' % c
    if k == 0: main.append('await %s;' % call)
    elif k == 1: main.append('await als.run("ctx %d", () => %s);' % (c, call))
    elif k == 2: main.append('running.push(als.run("ctx %d", () => %s));' % (c, call))
    elif k == 3: main.append('running.push(als.run("outer %d", () => other.run(%d, () => %s)));' % (c, c, call))
    elif k == 4: main.append('running.push(%s); bystanders("main %d");' % (call, c))
    else: main.append('await als.run("left %d", () => als.exit(() => %s));' % (c, call))
out.append('const running: Promise<void>[] = [];'); out += main
out.append('await Promise.all(running); at("all done"); await pending(5, 0); console.log(log.join("\\n"));')
print('\n'.join(out))
