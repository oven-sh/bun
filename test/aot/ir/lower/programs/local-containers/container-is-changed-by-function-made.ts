// RUN: lower
// OPTIONS: builtin-modules

// Nobody else has the container: the function that made it changes it by itself, by name, under a key that only the run knows, or through a built-in. What follows must see the change.
const lines: string[] = [];
const say = (title: string, value: unknown) => lines.push(title + ": " + JSON.stringify(value));
const identity = <T>(value: T) => value;
const keys = ["0", "push", "1", "length", "-1", "map", "4294967295", "4294967294", "x"];

function aMethodByName(count: number) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
        out.push(identity(i));
        if (i === 1) out.push = function (value: number) { Array.prototype.push.call(this, value * 10); return 0; };
    }
    return out;
}
say("a method is stored by name", aMethodByName(4));

function underAKeyOfTheRun(which: number) {
    const out: unknown[] & Record<string, unknown> = [1, 2] as never;
    const results: unknown[] = [];
    for (let turn = 0; turn < 3; turn++) {
        try {
            results.push(typeof out.push === "function" ? out.push(turn) : "no function");
        } catch (error) {
            results.push((error as Error).constructor.name);
        }
        if (turn === 0) out[identity(keys[which])] = turn === 0 ? (which === 3 ? 1 : () => "stored") : 0;
    }
    return [results, out.length, Object.keys(out).join()];
}
for (let which = 0; which < keys.length; which++) say("stored under " + keys[which], underAKeyOfTheRun(which));

function underANumberOfTheRun(position: number) {
    const out: number[] = [1, 2, 3];
    let sum = 0;
    for (let turn = 0; turn < 3; turn++) {
        out[identity(position)] = 7;
        for (let i = 0; i < 4; i++) sum += out[i] ?? 100;
        try {
            out.push(turn);
        } catch (error) {
            sum += (error as Error).constructor.name.length;
        }
    }
    return [sum, out.length, Object.keys(out).length, out[position]];
}
for (const position of [0, 2, 3, 5, -1, 1.5, 4294967294, 4294967295, NaN]) say("stored at " + position, underANumberOfTheRun(position));

function itsLength() {
    const out: number[] = [1, 2, 3, 4];
    out.length = identity(2);
    out.push(9);
    out.length = identity(6);
    let holes = 0;
    for (let i = 0; i < out.length; i++) if (!(i in out)) holes++;
    return [out, holes, out.indexOf(undefined as never), out.includes(undefined as never)];
}
say("its length", itsLength());

function anElementIsDeleted() {
    const out: number[] = [1, 2, 3];
    delete out[identity(1)];
    let text = "";
    out.forEach((value, index) => { text += index + "=" + value + ";"; });
    for (const value of out) text += String(value) + ",";
    return [text, out.map(value => value * 2), out.length];
}
say("an element is deleted", anElementIsDeleted());

function definedByADescriptor() {
    const out: number[] = [1, 2, 3];
    let calls = 0;
    Object.defineProperty(out, "map", { value: () => { calls++; return "mine"; } });
    Object.defineProperty(out, 0, { get: () => { calls++; return 70; } });
    return [out.map(value => value), out[0] + out[1], calls, out.reduce((sum, value) => sum + value, 0)];
}
say("defined by a descriptor", definedByADescriptor());

function assignedTo() {
    const out: number[] = [1, 2];
    Object.assign(out, identity({ push: () => "assigned", 1: 20 }));
    return [(out.push as unknown as () => string)(), out];
}
say("Object.assign", assignedTo());

function itsPrototype() {
    class Loud extends Array<number> { push(...values: number[]) { return super.push(...values.map(value => -value)); } }
    const out: number[] = [];
    out.push(1);
    Object.setPrototypeOf(out, Loud.prototype);
    out.push(2);
    return [out, out instanceof Loud, out.map(value => value) instanceof Loud];
}
say("its prototype", itsPrototype());

function itsConstructor() {
    class Other extends Array<number> {}
    const out: number[] & { constructor: unknown } = [1, 2, 3] as never;
    const before = out.map(value => value) instanceof Other;
    out.constructor = Other;
    return [before, out.map(value => value) instanceof Other, out.filter(() => true) instanceof Other, out.slice() instanceof Other];
}
say("its constructor", itsConstructor());

function madeNotExtensible() {
    const out: number[] = [1];
    Object.preventExtensions(out);
    let refused = "";
    try { out.push(2); } catch (error) { refused = (error as Error).constructor.name; }
    out[0] = 5;
    return [out, refused];
}
say("made not extensible", madeNotExtensible());

function aMapChangedByName() {
    const table = new Map<string, number>();
    table.set("a", 1);
    table.get = () => 77;
    (table as unknown as Record<string, unknown>)[identity("has")] = () => "stored";
    return [table.get("a"), table.has("a"), table.size];
}
say("a Map", aMapChangedByName());

function aRegularExpression() {
    const pattern = /a(b)?/g;
    const first = "ab a".replace(pattern, "x");
    pattern.exec = () => null;
    pattern.lastIndex = identity(1);
    return [first, "ab a".replace(pattern, "x"), pattern.test("ab"), pattern.lastIndex];
}
say("a regular expression", aRegularExpression());

function aPromise() {
    const promise = Promise.resolve(1);
    (promise as unknown as Record<string, unknown>).then = function (resolve: (value: number) => void) { resolve(2); };
    return promise;
}
async function awaited() { return await aPromise(); }
awaited().then(value => { say("a promise with a then of its own", value); console.log(lines.join("\n")); });

// GENERATED: aRegularExpression awaited identity push Loud
// CHECK-LABEL: function {{*}}name="aRegularExpression"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|boolean|number|string> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRegExp pattern="a(b)?" regExpFlags=[Global]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|RegExp site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = String string="ab a"
// CHECK-NEXT: v3 = PropGet v2 key="replace"
// CHECK-NEXT: v4 = String string="x"
// CHECK-NEXT: v5 = Call v3, v2, v1, v4 calleeKey="replace" calleeName="replace"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = NewClosure function=[[f_4]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v1, v8 key="exec"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="identity"
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Call v11, -, v12 calleeName="identity"
// CHECK-NEXT: v14 = Convert v13 declared={type=1 site=[[w_7]]} illTypedCause=FromLooseType
// CHECK-NEXT: v15 = Convert v14 declared={type=number site=[[w_8]]}
// CHECK-NEXT: PropSet v1, v15 key="lastIndex"
// CHECK-NEXT: v17 = String string="ab a"
// CHECK-NEXT: v18 = PropGet v17 key="replace"
// CHECK-NEXT: v19 = String string="x"
// CHECK-NEXT: v20 = Call v18, v17, v1, v19 calleeKey="replace" calleeName="replace"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = PropGet v1 key="test"
// CHECK-NEXT: v23 = String string="ab"
// CHECK-NEXT: v24 = Call v22, v1, v23 calleeKey="test" calleeName="pattern.test"
// CHECK-NEXT: v25 = Convert v24 declared={type=boolean site=[[w_10]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v26 = PropGet v1 key="lastIndex"
// CHECK-NEXT: v27 = Convert v26 declared={type=number site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v28 = NewArray v6, v21, v25, v27 contents=undefined|null|boolean|number|string
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|Array<undefined|null|boolean|number|string> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="awaited"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v2 = Call v1 calleeName="aPromise"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Await v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_13]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v6 = Convert v5 declared={type=number|object site=[[w_14]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="identity"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_15]] site=[[w_16]]}] results=[{type=undefined|null|[[L_15]] site=[[w_17]]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_15]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_15]] site=[[w_17]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="push"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|"assigned" site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_20]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="assigned"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|"assigned" site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Loud"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_21]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_21]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="push"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasRestParameter, HasThis, IsChecked, HasExplicitName] captures=[{type=function flags=[IsFromCompiler]}] thisType={type=[[L_21]] site=[[w_22]]} parameters=[{type=Array<number> site=[[w_23]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_24]]}] {
// CHECK-NEXT: b0(v0: function, v1: [[L_21]], v2: Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0 homeKind=ClassPrototype
// CHECK-NEXT: v4 = SuperGet v3, v1 key="push"
// CHECK-NEXT: v5 = NewArray contents=anything
// CHECK-NEXT: v6 = PropGet v2 key="map"
// CHECK-NEXT: v7 = NewClosure function=[[f_25]]
// CHECK-NEXT: v8 = Call v6, v2, v7 calleeKey="map" calleeName="values.map"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<number> site=[[w_26]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: AppendSpread v5, v9
// CHECK-NEXT: v11 = CallList v4, v1, v5 calleeName="super.push"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=number site=[[w_27]]}}, {declared={type=number site=[[w_24]]}}]
// CHECK-NEXT: }
