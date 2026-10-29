#!/usr/bin/env python3
"""microtask-order.py <seed> [<scenes>]: THE ORDER OF MICROTASKS IS LAW: every scene starts several async functions at once, beside chains of `.then` that count the ticks, and writes down who ran when. What is awaited or returned: plain values of every kind, promises settled | pending | rejected, promises of a subclass, promises whose `then` or `constructor` was replaced, thenables (own then, a getter, one that throws, one that calls back twice or late), other async functions (direct, through a variable, a method), async arrows, async generators and for await, Promise.all | race | allSettled | any; with try | catch | finally round the await, returns inside them, throws before and after the first await, awaits in loops, in arguments, in conditions. Every line as plain Bun's."""
import random, sys
seed = int(sys.argv[1]); count = int(sys.argv[2]) if len(sys.argv) > 2 else 40
R = random.Random(seed)
print('''declare const console: { log(...values: unknown[]): void };
let log: string[] = [];
const say = (s: string): void => { log.push(s); };
const ticks = (name: string, n: number): Promise<void> => { let p: Promise<void> = Promise.resolve(); for (let i = 0; i < n; i++) p = p.then(() => say(name + i)); return p; };
const show = (v: unknown): string => (v === null ? "null" : v === undefined ? "u" : typeof v === "object" ? "o" : typeof v === "function" ? "f" : String(v));
class Sub<T> extends Promise<T> {}
const quiet = <T>(p: Promise<T>): Promise<T> => { p.catch(() => {}); return p; };
const thenable = (v: unknown, tag: string): PromiseLike<unknown> => ({ then(ok: (x: unknown) => void) { say("then " + tag); ok(v); } }) as PromiseLike<unknown>;
const late = (v: unknown, tag: string): PromiseLike<unknown> => ({ then(ok: (x: unknown) => void) { say("late " + tag); Promise.resolve().then(() => ok(v)); } }) as PromiseLike<unknown>;
const twice = (v: unknown): PromiseLike<unknown> => ({ then(ok: (x: unknown) => void, no: (x: unknown) => void) { ok(v); ok("again"); no("no"); } }) as PromiseLike<unknown>;
const thrower = (): PromiseLike<unknown> => ({ then() { throw new RangeError("then throws"); } }) as PromiseLike<unknown>;
const getter = (v: unknown, tag: string): PromiseLike<unknown> => Object.defineProperty({}, "then", { get() { say("get then " + tag); return (ok: (x: unknown) => void) => ok(v); } }) as PromiseLike<unknown>;
const patched = (v: unknown, tag: string): Promise<unknown> => { const p = Promise.resolve(v); (p as any).then = function (a: any, b: any) { say("patched " + tag); return Promise.prototype.then.call(this, a, b); }; return p; };
const foreign = (v: unknown): Promise<unknown> => { const p = Promise.resolve(v); (p as any).constructor = Object; return p; };
async function plainly(v: unknown): Promise<unknown> { return v; }
async function afterOne(v: unknown): Promise<unknown> { await null; return v; }
async function failing(v: unknown): Promise<unknown> { throw v; }
async function failingLate(v: unknown): Promise<unknown> { await 0; throw v; }
async function* stream(n: number, tag: string): AsyncGenerator<number> { for (let i = 0; i < n; i++) { say("yield " + tag + i); yield i; } }
const holder = { async method(v: unknown): Promise<unknown> { return v; }, arrow: async (v: unknown): Promise<unknown> => v };''')
def value(tag):
    return R.choice(['1', '"s"', 'undefined', 'null', '({})', '[1]', '(() => 1)', '1.5', 'true',
      'Promise.resolve(2)', 'Promise.resolve(Promise.resolve(3))', 'new Promise(ok => ok(4))', 'new Promise(ok => Promise.resolve().then(() => ok(5)))', 'Sub.resolve(6)', 'new Sub(ok => ok(7))',
      'thenable(8, "%s")' % tag, 'late(9, "%s")' % tag, 'twice(10)', 'getter(11, "%s")' % tag, 'patched(12, "%s")' % tag, 'foreign(13)',
      'plainly(14)', 'afterOne(15)', 'plainly(plainly(16))', 'plainly(Promise.resolve(17))', 'holder.method(18)', 'holder.arrow(19)', 'plainly(thenable(20, "%s"))' % tag,
      'Promise.all([1, plainly(2), afterOne(3)])', 'Promise.race([afterOne(1), plainly(2)])', 'Promise.allSettled([failing(1), plainly(2)])', 'Promise.any([failing(1), afterOne(2)])',
      'quiet(Promise.reject(new TypeError("r")))', 'quiet(failing("f"))', 'quiet(failingLate("fl"))', 'thrower()', 'ticks("%s~", 2)' % tag])
def body(tag, depth):
    out = []
    for s in range(R.randrange(1, 5)):
        c = R.randrange(14); t = '%s.%d' % (tag, s)
        if c < 4: out.append('say("%s " + show(await %s));' % (t, value(t)))
        elif c == 4: out.append('try { say("%s " + show(await %s)); } catch (e) { say("%s caught " + show(e)); } finally { say("%s finally"); }' % (t, value(t), t, t))
        elif c == 5: out.append('for (let i = 0; i < 2; i++) say("%s " + i + show(await %s));' % (t, value(t)))
        elif c == 6: out.append('for await (const v of stream(2, "%s")) say("%s " + v);' % (t, t))
        elif c == 7: out.append('for await (const v of [%s, %s]) say("%s " + show(v));' % (value(t), value(t), t))
        elif c == 8: out.append('if (show(await %s) !== "u") say("%s yes"); else say("%s no");' % (value(t), t, t))
        elif c == 9: out.append('say("%s " + [show(await %s), show(await %s)].join());' % (t, value(t), value(t)))
        elif c == 10 and depth > 0: out.append('say("%s " + show(await (async () => { %s return %s; })()));' % (t, ' '.join(body(t + "i", depth - 1)), value(t)))
        elif c == 11: out.append('try { return %s; } finally { say("%s finally"); }' % (value(t), t))
        elif c == 12: out.append('try { return await %s; } catch (e) { say("%s caught " + show(e)); }' % (value(t), t))
        else: out.append('say("%s");' % t)
    return out
for p in range(count):
    n = R.randrange(2, 5); names = []
    print('{ log = [];')
    for i in range(n):
        tag = chr(65 + i); names.append('f' + tag)
        print('  %s { say("%s in"); %s return %s; }%s' % (R.choice(['async function f%s(): Promise<unknown>' % tag, 'const f%s = async (): Promise<unknown> =>' % tag]), tag, ' '.join(body(tag, 1)), value(tag + 'r'), ''))
    starts = ', '.join('%s().then(v => say("%s out " + show(v)), e => say("%s failed " + show(e)))' % (f, f[1], f[1]) for f in names)
    print('  const all = [%s, ticks("t", 14)]; say("started"); await Promise.all(all); await ticks("z", 6);' % starts)
    print('  console.log("s%d: " + log.join(" ")); }' % p)
