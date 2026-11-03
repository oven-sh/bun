// RUN: lower
// OPTIONS: builtin-modules

// next() written out on async generators that wait for something before they yield: who awaits the promise that next() handed back:
// an async function, an async generator, a then() callback, two of them, nobody yet, nobody ever; one request at a time and several at once;
// numbers, records and thenables yielded; the step objects are kept and compared: each step is an object of its own.
let log: string[] = [];
function note(text: string): void {
    log.push(text);
}
function ticker(label: string, turns: number): Promise<void> {
    let last: Promise<void> = Promise.resolve();
    for (let i = 1; i <= turns; i++) last = last.then(() => note(label + i));
    return last;
}
function outside(): Promise<void> {
    return new Promise(resolve => { Promise.resolve().then(() => undefined).then(() => resolve()); });
}
const thenable = { then(resolve: (value: string) => void): void { note("then is called"); resolve("from then"); } };
type Source = AsyncGenerator<unknown, unknown>;
const sources: [string, () => Source][] = [
    ["numbers", async function* () { for (let i = 0; i < 3; i++) { await outside(); note("yields " + i); yield i; } return "over"; }],
    ["records", async function* () { for (let i = 0; i < 3; i++) { await outside(); note("yields " + i); yield { n: i }; } return { last: true }; }],
    ["a thenable among them", async function* () { await outside(); yield 1; await outside(); yield thenable; await outside(); yield 3; }],
    ["two yields a wait", async function* () { for (let i = 0; i < 2; i++) { await outside(); yield "a" + i; yield "b" + i; } }],
    ["no wait", async function* () { yield 1; yield 2; }],
    ["a job queued ahead of the yield", async function* () { for (let i = 0; i < 2; i++) { await outside(); Promise.resolve().then(() => note("the source's job " + i)); yield i; } }],
    ["it throws", async function* () { await outside(); yield 1; await outside(); throw new Error("thrown by the source"); }],
    ["through yield*", async function* () { yield* (async function* () { await outside(); yield "inner"; await outside(); return "inner is over"; })(); yield "outer"; }],
];
function show(step: IteratorResult<unknown, unknown>): string {
    return (step.done ? "done " : "step ") + JSON.stringify(step.value) + " " + Object.keys(step).join(",");
}
const kept: object[] = [];
function keep(step: IteratorResult<unknown, unknown>): IteratorResult<unknown, unknown> {
    if (kept.includes(step)) note("THE SAME OBJECT TWICE");
    kept.push(step);
    return step;
}
async function byFunction(source: Source): Promise<void> {
    try {
        for (;;) { const step = keep(await source.next()); note(show(step)); if (step.done) return; }
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function* byGenerator(source: Source): AsyncGenerator<string> {
    try {
        for (;;) { const step = keep(await source.next()); yield show(step); if (step.done) return; }
    } catch (error) {
        yield "caught " + (error as Error).message;
    }
}
async function* relayed(source: Source): AsyncGenerator<unknown, unknown> {
    async function pulled(): Promise<IteratorResult<unknown, unknown>> {
        try { return await source.next(); } catch (error) { note("pulled caught"); throw error; }
    }
    while (true) {
        const step = keep(await pulled());
        if (step.done === true) return step.value;
        yield step.value;
    }
}
function byThen(source: Source): Promise<void> {
    return new Promise(resolve => {
        const pull = (): void => { source.next().then(step => { note(show(keep(step))); if (step.done) resolve(); else pull(); }, error => { note("then caught " + error.message); resolve(); }); };
        pull();
    });
}
async function collect(source: AsyncIterable<unknown>): Promise<void> {
    try {
        for await (const x of source) note("got " + JSON.stringify(x));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function severalAtOnce(source: Source): Promise<void> {
    const steps = await Promise.allSettled([source.next(), source.next(), source.next(), source.next(), source.next()]);
    for (const step of steps) note(step.status === "fulfilled" ? show(keep(step.value)) : "rejected " + step.reason.message);
}
async function awaitedLater(source: Source): Promise<void> {
    const first = source.next();
    for (let i = 0; i < 6; i++) await outside();
    note("now awaited");
    try { note(show(keep(await first))); } catch (error) { note("caught " + (error as Error).message); }
    await byFunction(source);
}
async function awaitedByTwo(source: Source): Promise<void> {
    const first = source.next();
    const both = await Promise.allSettled([(async () => show(await first))(), (async () => show(await first))()]);
    for (const one of both) note(one.status === "fulfilled" ? one.value : "rejected");
    note("one object for both: " + ((await first) === (await first)));
    await byFunction(source);
}
async function neverAwaited(source: Source): Promise<void> {
    source.next().catch(() => undefined); source.next().catch(() => undefined);
    for (let i = 0; i < 8; i++) await outside();
    await byFunction(source);
}
async function* yieldsWhatNextHandsBack(source: Source): AsyncGenerator<IteratorResult<unknown, unknown>> {
    for (let i = 0; i < 5; i++) yield source.next();
}
async function* returnsWhatNextHandsBack(source: Source): AsyncGenerator<never, IteratorResult<unknown, unknown>> {
    return source.next();
}
async function yielded(source: Source): Promise<void> {
    try {
        for await (const step of yieldsWhatNextHandsBack(source)) note(show(keep(step)));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
}
async function returned(source: Source): Promise<void> {
    try {
        const last = await returnsWhatNextHandsBack(source).next();
        note("returned " + last.done + " " + show(keep(last.value)));
    } catch (error) {
        note("caught " + (error as Error).message);
    }
    await byFunction(source);
}
const ways: [string, (source: Source) => Promise<void>][] = [
    ["the promise is yielded", yielded],
    ["the promise is returned", returned],
    ["an async function awaits", byFunction],
    ["an async generator awaits", source => collect(byGenerator(source))],
    ["relayed", source => collect(relayed(source))],
    ["relayed twice", source => collect(relayed(relayed(source)))],
    ["then", byThen],
    ["several at once", severalAtOnce],
    ["awaited later", awaitedLater],
    ["awaited by two", awaitedByTwo],
    ["never awaited", neverAwaited],
];
const lines: string[] = [];
async function scene(title: string, run: () => Promise<unknown>): Promise<void> {
    log = []; kept.length = 0;
    await run();
    lines.push(title + ": " + log.join(" | "));
}
for (const [way, go] of ways) {
    for (const [kind, make] of sources) {
        await scene(way + ", " + kind + ", alone", () => go(make()));
        await scene(way + ", " + kind + ", beside jobs", () => Promise.all([ticker("t", 20), go(make())]));
        await scene(way + ", " + kind + ", two at once", () => Promise.all([go(make()), go(make())]));
    }
}
console.log(lines.join("\n"));

// GENERATED: ticker collect returnsWhatNextHandsBack
// CHECK-LABEL: function {{*}}name="ticker"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_2]]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Promise" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="resolve"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Jump -> next b2(v8, v10)
// CHECK-NEXT: b2(v11, v12: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v14 = LessEq v12, v1
// CHECK-NEXT: Branch v14 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v15, v16):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v17 = PropGet v11 key="then"
// CHECK-NEXT: v18 = NewClosure v0, v15 function=[[f_4]]
// CHECK-NEXT: v19 = Call v17, v11, v18 calleeKey="then" calleeName="last.then"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Increment v15
// CHECK-NEXT: v22 = Convert v21 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Jump -> next b2(v20, v22)
// CHECK-NEXT: b6(v23, v24):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v25 = Convert v11 declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="collect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|AsyncGenerator flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|AsyncGenerator):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b9():
// CHECK-NEXT: v2 = IteratorOpen v1 iteratorKind=Async
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b9():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v4 = IteratorResume v2, -, v1 iteratorKind=Async
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Branch v5 -> taken b4(), notTaken b6()
// CHECK-NEXT: b4() handler=b9():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b6() handler=b9():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b8():
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v8 = String string="got "
// CHECK-NEXT: v9 = Builtin builtin=JSON
// CHECK-NEXT: v10 = PropGet v9 key="stringify"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, v9, v6 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = Add v8, v13
// CHECK-NEXT: v15 = Call v7, -, v14 calleeName="note"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b8() role=IterationCleanup subject=v2 handler=b9():
// CHECK-NEXT: v16 = CatchException
// CHECK-NEXT: IteratorClose v2, v1 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v16
// CHECK-NEXT: b9() role=CatchHandler:
// CHECK-NEXT: v18 = CatchValue
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v20 = String string="caught "
// CHECK-NEXT: v21 = Convert v18 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v22 = PropGet v21 key="message"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v24 = Add v20, v23
// CHECK-NEXT: v25 = Call v19, -, v24 calleeName="note"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="returnsWhatNextHandsBack"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|AsyncGenerator flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|AsyncGenerator<never> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: undefined|null|AsyncGenerator):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = PropGet v2 key="next"
// CHECK-NEXT: v5 = Call v4, v2 calleeKey="next" calleeName="source.next"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Promise<undefined|null|[[L_8]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Await v6, v2
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
