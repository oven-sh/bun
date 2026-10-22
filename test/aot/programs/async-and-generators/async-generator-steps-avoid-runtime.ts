// next() of an async generator that `for await` or `yield*` of compiled code drives is carried out by a stub, whatever the generator function looks like: what it yields, how it takes its
// parameters, how many variables it has, how many other generator functions stand beside it. The program counts the entries of the operation that the stub leaves for.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
function entered(): number { return counted ? counted("operationAOTAsyncIteratorStep") : 0; }
const lines: string[] = [];
type Stream = AsyncGenerator<unknown, void, unknown>;
interface Chunk { n: number; text: string; }
async function* yieldsItsVariable(count: number): Stream { for (let i = 0; i < count; i++) yield i; }
async function* yieldsAProduct(count: number): Stream { for (let i = 0; i < count; i++) yield i * 2; }
async function* yieldsASum(count: number): Stream { for (let i = 0; i < count; i++) yield i + 1; }
async function* yieldsAFraction(count: number): Stream { for (let i = 0; i < count; i++) yield i / 3; }
async function* yieldsARecord(count: number): Stream { for (let i = 0; i < count; i++) yield { n: i }; }
async function* yieldsALargerRecord(count: number): AsyncGenerator<Chunk, void, unknown> { for (let i = 0; i < count; i++) yield { n: i, text: "t" }; }
async function* yieldsAnArray(count: number): Stream { for (let i = 0; i < count; i++) yield [i, i]; }
async function* yieldsAString(count: number): Stream { for (let i = 0; i < count; i++) yield "s" + (i % 10); }
async function* yieldsNothingMuch(count: number): Stream { for (let i = 0; i < count; i++) yield undefined; }
async function* yieldsABoolean(count: number): Stream { for (let i = 0; i < count; i++) yield i % 2 === 0; }
async function* awaitsFirst(count: number): Stream { for (let i = 0; i < count; i++) { await null; yield i; } }
async function* awaitsAPromiseFirst(count: number): Stream { const settled = Promise.resolve(1); for (let i = 0; i < count; i++) yield i + await settled; }
async function* hasAFinally(count: number): Stream { try { for (let i = 0; i < count; i++) yield i; } finally { lines.length; } }
async function* hasACatch(count: number): Stream { for (let i = 0; i < count; i++) { try { yield i; } catch (error) { yield error; } } }
async function* hasManyVariables(count: number): Stream {
    let a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8, j = 9, k = 10, l = 11, m = 12, n = 13, o = 14, p = 15, q = 16;
    for (let i = 0; i < count; i++) {
        a += b; b += c; c += d; d += e; e += f; f += g; g += h; h += j; j += k; k += l; l += m; m += n; n += o; o += p; p += q; q = (q + a) % 97;
        a %= 97; b %= 97; c %= 97; d %= 97; e %= 97; f %= 97; g %= 97; h %= 97; j %= 97; k %= 97; l %= 97; m %= 97; n %= 97; o %= 97; p %= 97;
        yield a + b + c + d + e + f + g + h + j + k + l + m + n + o + p + q;
    }
}
async function* yieldsTwiceATurn(count: number): Stream { for (let i = 0; i < count; i += 2) { yield i; yield { n: i + 1 }; } }
async function* closesOverItsVariable(count: number): Stream { for (let i = 0; i < count; i++) { const read = () => i; yield read(); } }
async function* takesAPattern({ count }: { count: number }): Stream { for (let i = 0; i < count; i++) yield i; }
async function* takesADefault(count: number, step: number = 1): Stream { for (let i = 0; i < count; i += step) yield { n: i }; }
async function* takesARest(...counts: number[]): Stream { for (let i = 0; i < counts[0]; i++) yield i; }
async function* forwards(inner: Stream): Stream { yield* inner; }
async function* forwardsAPattern({ inner }: { inner: Stream }): Stream { yield* inner; }
async function* relays(inner: Stream): Stream { for await (const x of inner) yield x; }
class Holder {
    constructor(private base: number) {}
    async *stream(count: number): Stream { for (let i = 0; i < count; i++) yield this.base + i; }
    static async *ofClass(count: number): Stream { for (let i = 0; i < count; i++) yield { n: i }; }
}
const expression = async function* (count: number): Stream { for (let i = 0; i < count; i++) yield -i; };
const inObject = { async *stream(count: number): Stream { for (let i = 0; i < count; i++) yield [i]; } };
async function measure(label: string, calls: number, make: () => AsyncGenerator<unknown, void, unknown>): Promise<void> {
    await null;
    const before = entered();
    let steps = 0;
    for await (const x of make()) steps += x === lines ? 2 : 1;
    const entries = entered() - before;
    lines.push(label + ": " + steps + " steps, " + (entries * 20 < calls ? "few entries" : entries + " ENTRIES FOR " + calls + " CALLS OF next()"));
}
const N = 2000;
for (let round = 0; round < 2; round++) {
    await measure("yields its variable", N, () => yieldsItsVariable(N));
    await measure("yields a product", N, () => yieldsAProduct(N));
    await measure("yields a sum", N, () => yieldsASum(N));
    await measure("yields a fraction", N, () => yieldsAFraction(N));
    await measure("yields a record", N, () => yieldsARecord(N));
    await measure("yields a larger record", N, () => yieldsALargerRecord(N));
    await measure("yields an array", N, () => yieldsAnArray(N));
    await measure("yields a string", N, () => yieldsAString(N));
    await measure("yields nothing much", N, () => yieldsNothingMuch(N));
    await measure("yields a boolean", N, () => yieldsABoolean(N));
    await measure("awaits first", N, () => awaitsFirst(N));
    await measure("awaits a promise first", N, () => awaitsAPromiseFirst(N));
    await measure("has a finally", N, () => hasAFinally(N));
    await measure("has a catch", N, () => hasACatch(N));
    await measure("has many variables", N, () => hasManyVariables(N));
    await measure("yields twice a turn", N, () => yieldsTwiceATurn(N));
    await measure("closes over its variable", N, () => closesOverItsVariable(N));
    await measure("takes a pattern", N, () => takesAPattern({ count: N }));
    await measure("takes a default", N, () => takesADefault(N));
    await measure("takes a rest", N, () => takesARest(N, 1, 2));
    await measure("forwards", 2 * N, () => forwards(yieldsARecord(N)));
    await measure("forwards twice", 3 * N, () => forwards(forwards(yieldsItsVariable(N))));
    await measure("forwards what awaits", 2 * N, () => forwards(awaitsFirst(N)));
    await measure("forwards, by a pattern", 2 * N, () => forwardsAPattern({ inner: takesAPattern({ count: N }) }));
    await measure("relays", 2 * N, () => relays(yieldsALargerRecord(N)));
    await measure("relays what forwards", 3 * N, () => relays(forwards(yieldsAString(N))));
    await measure("a method", N, () => new Holder(round).stream(N));
    await measure("a static method", N, () => Holder.ofClass(N));
    await measure("a function expression", N, () => expression(N));
    await measure("a method of an object literal", N, () => inObject.stream(N));
}
console.log(lines.join("\n"));
