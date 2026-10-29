// RUN: lower
// OPTIONS: builtin-modules

// Patterns are recompiled, moved and emptied by the callbacks and conversions that run while strings are matched, replaced and split.
function show(f) { try { const v = f(); return typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (e) { return "threw " + e.constructor.name; } }
const text = "aa1bb22cc333dd4444" + "é".repeat(3) + "\u{1F600}x9";
const lines = [];
for (const flags of ["", "g", "y", "gy", "gu", "gi", "gd", "gv", "gs", "gm"]) {
    const make = () => new RegExp("(\\d+)|(?<w>[a-c])", flags);
    const scenes = {
        compileInCallback: r => text.replace(r, m => { r.compile("z", flags.replace(/[dv]/g, "")); return "<" + m + ">"; }),
        compileToGroups: r => text.replace(r, (...a) => { r.compile("(a)(b)(c)(d)?", "g"); return a.length; }),
        lastIndexInCallback: r => text.replace(r, m => { r.lastIndex = 1e9; return "#"; }) + r.lastIndex,
        lastIndexObject: r => { let n = 0; r.lastIndex = { valueOf() { n++; r.compile("b+", flags.replace(/[dv]/g, "")); return 2; } }; return JSON.stringify(r.exec(text)) + n + "," + show(() => r.lastIndex); },
        negative: r => { r.lastIndex = -5; return JSON.stringify(r.exec(text)) + r.lastIndex; },
        fraction: r => { r.lastIndex = 2.7; return JSON.stringify(r.exec(text)) + r.lastIndex; },
        inSurrogate: r => { r.lastIndex = text.indexOf("\u{1F600}") + 1; return JSON.stringify(r.exec(text)) + r.lastIndex; },
        frozen: r => { Object.freeze(r); return show(() => r.exec(text)) + show(() => text.replace(r, "x")) + show(() => r.test(text)); },
        readOnlyLastIndex: r => { Object.defineProperty(r, "lastIndex", { value: 3, writable: false }); return show(() => r.exec(text)) + show(() => text.match(r)) + show(() => text.split(r).length); },
        ownExec: r => { r.exec = function (s) { this.exec = undefined; return null; }; return show(() => text.replace(r, "x")) + show(() => r.test(text)) + show(() => text.match(r)); },
        ownExecBad: r => { r.exec = () => 5; return show(() => r.test(text)) + show(() => text.replace(r, "x")); },
        ownExecArrayLike: r => { let n = 0; r.exec = () => n++ ? null : { index: 1e9, length: 3, 0: "q", 1: { toString() { return "g1"; } }, 2: undefined, groups: { w: "W" } }; return show(() => text.replace(r, "[$1|$2|$<w>|$&]")); },
        ownFlags: r => { Object.defineProperty(r, "flags", { value: "g" }); return show(() => text.replace(r, "x")) + show(() => [...text.matchAll(r)].length); },
        ownGlobal: r => { Object.defineProperty(r, "global", { get() { return true; } }); return show(() => text.replace(r, "x")); },
        matchAllThenCompile: r => { const it = text.matchAll(r); const a = it.next(); r.compile("nothing"); return JSON.stringify([a, it.next()]); },
        splitLimit: r => JSON.stringify(text.split(r, { valueOf() { r.compile("c"); return 4; } })),
        species: r => { r.constructor = { [Symbol.species]: function (p, f) { return new RegExp("b", f); } }; return JSON.stringify(text.split(r)) + show(() => [...text.matchAll(r)].length); },
        replaceValueObject: r => text.replace(r, { toString() { r.lastIndex = 5; return "$2$1$0$9$<w>$<none>$'"; } }).length,
        subject: r => r.exec({ toString() { r.compile("dd"); return text; } }),
        legacy: r => { r.exec(text); return [RegExp.$1, RegExp.lastMatch, RegExp.leftContext.length, RegExp["$+"], RegExp.input === text].join(); },
        emptyMatches: r => { r.compile("", flags.replace(/[dv]/g, "")); return text.replace(r, "-").length + "," + show(() => text.match(r)?.length) + "," + text.split(r).length; },
        collect: r => text.replace(r, m => { Bun.gc(true); return m + m; }),
        rope: r => { let s = ""; for (let i = 0; i < 50; i++) s += text; return s.replace(r, (m, a, b, at) => at % 7 ? "" : m).length; },
        subclass: r => { class R extends RegExp { exec(s) { const m = super.exec(s); if (m) m[0] = "!"; return m; } } const x = new R(r.source, flags); return show(() => text.replace(x, "[$&]")) + show(() => text.search(x)) + show(() => x.test(text)); },
        indices: r => JSON.stringify(r.exec(text)?.indices ?? null),
        symbolOff: r => { r[Symbol.match] = false; return show(() => text.includes(r)) + show(() => text.startsWith(r)); },
        source: r => [r.source, r.flags, String(r), r.sticky, r.unicode, r.hasIndices, r.dotAll].join(),
    };
    for (const [name, scene] of Object.entries(scenes)) if (flags.includes("g") || !["ownFlags", "ownGlobal"].includes(name)) for (const warm of [false, true]) { const r = make(); if (warm) { r.test(text); text.replace(r, "x"); r.lastIndex = 0; } lines.push(flags + " " + name + " " + warm + " " + show(() => scene(r)) + " @" + show(() => r.lastIndex)); }
}
console.log(lines.join("\n"));

// GENERATED: symbolOff valueOf R exec
// CHECK-LABEL: function {{*}}name="symbolOff"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Boolean
// CHECK-NEXT: PropSet v0, v1 key=@@match
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="show"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v8 = NewClosure v0 function=[[f_5]]
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="show"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v11 = Add v6, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_6]] flags=[IsFromCompiler]}, {type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|[[L_7]] flags=[IsExpected]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: env [[L_6]], v1: undefined|null|string, v2: undefined|null|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_6]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="n"
// CHECK-NEXT: v5 = Increment v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v7 = GetEnvironmentField v0 layout=[[L_6]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="n"
// CHECK-NEXT: PutEnvironmentField v0, v6 layout=[[L_6]]
// CHECK-NEXT: v10 = PropGet v2 key="compile"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="b+"
// CHECK-NEXT: v13 = PropGet v1 key="replace"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v15 = NewRegExp pattern="[dv]" regExpFlags=[Global]
// CHECK-NEXT: v16 = String string=""
// CHECK-NEXT: v17 = Call v14, v1, v15, v16 calleeKey="replace" calleeName="flags.replace"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v11, v2, v12, v18 calleeKey="compile" calleeName="r.compile"
// CHECK-NEXT: v20 = Integer integer=2
// CHECK-NEXT: v21 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=undefined|null|string|[[L_1]]|[[L_10]] flags=[IsExpected]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|[[L_1]]|[[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="compile"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="c"
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="compile" calleeName="r.compile"
// CHECK-NEXT: v5 = Integer integer=4
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="R"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_12]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="exec"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 captures=[{type=function flags=[IsFromCompiler]}] thisType={type=[[L_12]] flags=[IsExpected]} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: function, v1: [[L_12]], v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0 homeKind=ClassPrototype
// CHECK-NEXT: v4 = SuperGet v3, v1 key="exec"
// CHECK-NEXT: v5 = Call v4, v1, v2 calleeName="super.exec"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v7 = ToBoolean v6
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = String string="!"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: ElemSet v8, v9, v11
// CHECK-NEXT: Jump -> next b5(v8)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Jump -> next b5(v13)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
