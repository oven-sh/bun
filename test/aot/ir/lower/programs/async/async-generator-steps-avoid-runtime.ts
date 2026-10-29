// RUN: lower
// OPTIONS: builtin-modules

// next() of an async generator that `for await` or `yield*` of compiled code drives is carried out by a stub, whatever the generator function looks like: what it yields, how it takes its
// parameters, how many variables it has, how many other generator functions stand beside it. The program counts the entries of the operation that the stub leaves for.
declare const aotRuntimeCounters: undefined | (() => string);
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
const countsSoFar = (): string => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for, but for the operations named.
function callsIn(counts: string, ...besides: string[]): number {
    let sum = 0;
    for (const line of counts.split("\n")) {
        const [calls, name] = line.split("\toperation:");
        if (name !== undefined && !besides.includes(name)) sum += Number(calls);
    }
    return sum;
}
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
    const before = countsSoFar();
    let steps = 0;
    for await (const x of make()) steps += x === lines ? 2 : 1;
    const entries = callsIn(countsSoFar()) - callsIn(before);
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

// GENERATED: forwards Holder countsSoFar read
// CHECK-LABEL: function {{*}}name="forwards"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|AsyncGenerator flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|AsyncGenerator flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: undefined|null|AsyncGenerator):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = IteratorOpen v2 iteratorKind=Async [isDelegating]
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Jump -> next b2(v5)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = IteratorResume v4, v6, v2 iteratorKind=Async [readsValueWhenDone]
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b5(v9), notTaken b3(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = Yield v10, v2
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b4(v13), case b6(v13), otherwise b2(v13)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: v16 = IteratorResume v4, v15, v2 iteratorKind=Async resumeMode=Throw [readsValueWhenDone]
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: Branch v17 -> taken b5(v18), notTaken b3(v18)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = IteratorResume v4, v21, v2 iteratorKind=Async resumeMode=Return [readsValueWhenDone]
// CHECK-NEXT: v23 = ResultAt v22
// CHECK-NEXT: v24 = ResultAt v22 index=1
// CHECK-NEXT: Branch v23 -> taken b7(v24), notTaken b3(v24)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_3]]
// CHECK-NEXT: PropSet v4, v1 key="base"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="countsSoFar"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="aotRuntimeCounters" [isFreeName, isForTypeOf]
// CHECK-NEXT: v2 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="aotRuntimeCounters" [isFreeName]
// CHECK-NEXT: v6 = Call v5 calleeName="aotRuntimeCounters"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = String string=""
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=number site=[[w_7]]}] thisType={type=anything} results=[{type=number site=[[w_8]]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
