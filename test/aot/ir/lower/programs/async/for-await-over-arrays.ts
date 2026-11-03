// RUN: lower
// OPTIONS: builtin-modules

// `for await` over arrays: as they are made, and in every way an array can stop iterating the way it was made.
const log: string[] = [];
function note(...parts: unknown[]): void {
    log.push(parts.map(part => String(part)).join(" "));
}

async function over(label: string, values: Iterable<unknown> | AsyncIterable<unknown>, leavesAt = -1): Promise<void> {
    let seen = 0;
    try {
        for await (const value of values) {
            note(label, "sees", value);
            if (seen++ === leavesAt) {
                note(label, "breaks");
                break;
            }
        }
        note(label, "ends");
    } catch (error) {
        note(label, "caught", error instanceof Error ? error.message : error);
    }
}

async function ticks(label: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
        await null;
        note(label, i);
    }
}

class Listing extends Array<number> {
    *[Symbol.iterator](): ArrayIterator<number> {
        note("Listing is asked for its iterator");
        for (let i = this.length; i-- > 0;)
            yield this[i];
    }
}

async function main(): Promise<void> {
    await over("empty", []);
    await over("numbers", [1, 2, 3]);
    await over("mixed", [1, "two", null, undefined, { toString: () => "five" }]);
    await over("promises", [Promise.resolve("a"), "b", Promise.resolve("c")]);
    await over("holes", [1, , 3]);
    await over("left early", [1, 2, 3, 4], 1);
    await over("rejected", [1, Promise.reject(new Error("no")), 3]);
    await over("thenable", [{ then(resolve: (value: string) => void) { note("then is called"); resolve("from then"); } }, "after"]);

    const growing = [1, 2];
    let grown = 0;
    for await (const value of growing) {
        note("growing sees", value);
        if (grown++ < 3)
            growing.push(value + 10);
    }
    const shrinking = [1, 2, 3, 4];
    for await (const value of shrinking) {
        note("shrinking sees", value);
        shrinking.pop();
    }

    const withAsync = [1, 2] as number[] & { [Symbol.asyncIterator]?: () => AsyncIterator<string> };
    withAsync[Symbol.asyncIterator] = async function* () {
        note("its own async iterator is asked for");
        yield "own async";
    };
    await over("own Symbol.asyncIterator", withAsync);

    const withSync = [1, 2];
    withSync[Symbol.iterator] = function* () {
        note("its own iterator is asked for");
        yield 7;
    } as any;
    await over("own Symbol.iterator", withSync);

    const withNull = [5, 6] as number[] & { [Symbol.asyncIterator]?: null };
    withNull[Symbol.asyncIterator] = null;
    await over("Symbol.asyncIterator is null", withNull);

    const named = [8, 9] as number[] & { name?: string };
    named.name = "has a property";
    await over("with a property", named);

    await over("subclass", Listing.from([1, 2, 3]));
    await over("frozen", Object.freeze([1, 2]));
    await over("doubles", [0.5, 1.5, -0]);
    await over("array iterator", [1, 2, 3].values());
    await over("entries", ["a", "b"].entries());
    await over("Set", new Set([1, 1, 2]));
    await over("Map", new Map([["k", 1]]));
    await over("string", "hé!");

    const inherits = Object.setPrototypeOf([1, 2], { [Symbol.iterator]: function* () { yield "from another prototype"; } }) as number[];
    await over("another prototype", inherits);

    await Promise.all([over("left", [1, 2, 3]), ticks("tick", 12), over("right", ["x", Promise.resolve("y")])]);

    let sum = 0;
    for (let round = 0; round < 200; round++) {
        for await (const value of [round, round + 1, round + 2])
            sum += value;
    }
    note("sum", sum);
    console.log(log.join("\n"));
}

main();

// GENERATED: ticks Listing [Symbol.iterator]
// CHECK-LABEL: function {{*}}name="ticks"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_2]]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Jump -> next b2(v4)
// CHECK-NEXT: b2(v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = Less v5, v2
// CHECK-NEXT: Branch v7 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v8, v9):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = Null
// CHECK-NEXT: v11 = Await v10, v1, v9
// CHECK-NEXT: v12 = Convert v11 declared={type=null site=[[w_4]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v14 = Call v13, -, v1, v8 calleeName="note"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v15 = Increment v8
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Jump -> next b2(v16)
// CHECK-NEXT: b6(v17, v18):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Listing"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, IsChecked, IsNamedByComputedKey] thisType={type=[[L_6]] site=[[w_7]]} results=[{type=undefined|null|[[L_8]]|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_6]], v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v4 = String string="Listing is asked for its iterator"
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="note"
// CHECK-NEXT: v6 = PropGet v0 key="length"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Jump -> next b2(v7)
// CHECK-NEXT: b2(v8: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v10 = ToNumeric v8
// CHECK-NEXT: v11 = Decrement v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v13 = Integer
// CHECK-NEXT: v14 = Greater v10, v13
// CHECK-NEXT: Branch v14 -> taken b3(), notTaken b8()
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = ElemGet v0, v12
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|number site=[[w_10]]} illTypedCause=FromLooseType
// CHECK-NEXT: v17 = Yield v16
// CHECK-NEXT: v18 = ResultAt v17
// CHECK-NEXT: v19 = ResultAt v17 index=1
// CHECK-NEXT: Switch v19 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v18
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v18
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: Jump -> next b2(v12)
// CHECK-NEXT: b8():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = String string="from another prototype"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
