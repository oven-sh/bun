// RUN: lower
// OPTIONS: builtin-modules

// A typed read is tested wherever it stands: under `typeof`, against `undefined` or a literal, in a condition, as a binding, an argument or an operand. A field that holds another kind throws a TypeError; one that is undefined, null or missing passes and goes on as it is.
interface Clock { origin: number; name: string; on: boolean; next: Clock; list: number[]; tick: () => number; big: bigint }
declare function fromHost(which: number): Clock;
const raws: any[] = [0, 1].map(() => JSON.parse('{"origin":1,"name":"n","on":true,"next":null,"list":[1],"tick":null,"big":null}'));
for (const raw of raws) { raw.next = raw; raw.tick = () => 7; raw.big = 5n; }
(globalThis as any).fromHost = (which: number) => raws[which];
const kept: Clock = fromHost(0), broken: Clock = fromHost(1);
{ const raw = raws[1]; raw.origin = undefined; raw.name = 5; raw.on = "yes"; raw.next = 0; delete raw.list; raw.tick = null; raw.big = ""; }
// The object under test. It goes from one place of type `Clock` to another, which asks only for an object.
let c: Clock = kept;
function attempt(label: string, f: () => unknown): void {
    const out: string[] = [];
    for (let which = 0; which < 2; which++) {
        c = which === 0 ? kept : broken;
        try { out.push(show(f())); } catch (e) { out.push((e as Error).constructor.name); }
    }
    console.log(label, out.join(" | "));
}
function show(v: unknown): string {
    return typeof v === "bigint" ? v + "n" : typeof v === "function" ? "fn" : typeof v === "object" && v !== null ? "obj" : typeof v === "string" ? JSON.stringify(v) : String(v);
}

// typeof
attempt("t typeof", () => [typeof c.origin, typeof c.name, typeof c.on, typeof c.next, typeof c.list, typeof c.tick, typeof c.big].join());
attempt("t typeof ===", () => typeof c.origin === "number" && typeof c.tick === "function");
attempt("t typeof through", () => [typeof (c.origin), typeof c.origin!, typeof (c.origin satisfies number), typeof (c.name)!].join());
attempt("a typeof as", () => [typeof (c.origin as number), typeof ((c.name as string)!), (c.on as boolean) === true].join());
// equality against undefined, null, a literal
attempt("t === undefined", () => [c.origin === undefined, c.list === undefined, undefined !== c.name, c.tick === undefined].join());
attempt("t === null", () => [c.tick === null, null === c.next, c.origin !== null].join());
attempt("t == null", () => [c.origin == null, c.tick == null, c.list != null, null == c.name, c.on == undefined].join());
attempt("t === literal", () => [c.origin === 1, c.name === "n", c.on === true, 5 === c.name as unknown, c.big === 5n, c.origin === -1, c.name !== "x", c.on === false].join());
attempt("t == literal", () => [c.origin == 1, c.name == "5", "" == c.big as unknown, c.on != true].join());
// conditions
attempt("t if", () => { if (c.origin) return "T"; return "F"; });
attempt("t if string", () => { if (c.name) return "T"; return "F"; });
attempt("t if boolean", () => { if (c.on) return "T"; return "F"; });
attempt("t if object", () => { if (c.next) return "T"; return "F"; });
attempt("t if through", () => { if ((c.list as number[])!) return "T"; return "F"; });
attempt("t ?:", () => (c.next ? "T" : "F") + (c.big ? "T" : "F"));
attempt("t while", () => { let n = 0; while (c.list && n < 2) n++; return n; });
attempt("t do", () => { let n = 0; do n++; while (c.origin && n < 2); return n; });
attempt("t for", () => { let n = 0; for (; c.next && n < 2; n++); return n; });
// !
attempt("t !", () => [!c.origin, !c.name, !c.on, !c.next, !c.list, !c.tick, !c.big].join());
attempt("t !!", () => [!!c.origin, !!c.list, Boolean(c.tick)].join());
// in, instanceof
attempt("t in", () => ["length" in (c.list ?? []), (c.name as unknown as string) in { n: 1, 5: 1 }].join());
attempt("t instanceof", () => [c.list instanceof Array, c.next instanceof Object, c.tick instanceof Function, (c.origin as unknown) instanceof Number].join());
// the left side of && and ||, in a condition and for its value
attempt("t && condition", () => { if (c.origin && c.on) return "T"; return "F"; });
attempt("t || condition", () => { if (c.list || c.next) return "T"; return "F"; });
attempt("t && falls through", () => c.list && "there");
attempt("t || falls through", () => c.origin || "none");
// the left side of ??, the receiver of ?.
attempt("t ??", () => [c.origin ?? "none", c.list ?? "none", c.tick ?? "none"].map(show).join());
attempt("t ?.", () => [c.list?.length, c.tick?.(), c.list?.[0]].join());
attempt("t ?. ??", () => c.list?.length ?? "none");
// an expression that forwards its operand
attempt("t ?: within typeof", () => typeof (c.on ? c.origin : c.name));
attempt("t || within typeof", () => [typeof (c.name || c.origin), typeof (c.big && c.on), typeof (c.name ?? c.on)].join());
attempt("t || within ===", () => (c.name || "x") === "n");
attempt("t , within if", () => { let n = 0; if ((n++, c.list)) return "T" + n; return "F" + n; });

// bindings, arguments, operands, results, receivers
attempt("h binding", () => { const t = c.origin; return typeof t === "number"; });
attempt("h argument", () => show(c.name));
attempt("h arithmetic", () => c.origin + 1);
attempt("h operand of an operand", () => { if (c.origin + 1) return "T"; return "F"; });
attempt("h === not a literal", () => c.origin === kept.origin);
attempt("h relational", () => c.origin < 2);
attempt("h return", () => c.on);
attempt("h receiver", () => c.list.length);
attempt("h call", () => c.tick());
attempt("h template", () => `${c.name}`);
// the left side of &&, || and ?? for its value
attempt("t && lets through", () => c.name && "x");
attempt("h && kept", () => c.big && "x");
attempt("h || kept", () => c.name || "none");
attempt("t || falls through, object", () => c.next || "none");
attempt("h ?? kept", () => c.name ?? "none");
attempt("h ?. receiver that is no object", () => c.next?.origin);
export {};

// GENERATED: attempt
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Data data=[[d_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<undefined|null|string> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Jump -> next b2(v5)
// CHECK-NEXT: b2(v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b3(| 0), notTaken b15(| 0)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="c"
// CHECK-NEXT: v13 = Integer
// CHECK-NEXT: v14 = StrictEq v10, v13
// CHECK-NEXT: Branch v14 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="kept"
// CHECK-NEXT: Jump -> next b9(v17, v15)
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="broken"
// CHECK-NEXT: Jump -> next b9(v20, v18)
// CHECK-NEXT: b9(v21, v22: number):
// CHECK-NEXT: v23 = Convert v21 declared={type=undefined|null|[[L_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutModuleVariable v23 variable=[[g_7]]
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b12():
// CHECK-NEXT: v25 = PropGet v3 key="push"
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v27 = Call v1 calleeName="f"
// CHECK-NEXT: v28 = Call v26, -, v27 calleeName="show"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v30 = Call v25, v3, v29 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v31 = Convert v30 declared={type=number site=[[w_14]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b12() role=CatchHandler:
// CHECK-NEXT: v32 = CatchValue
// CHECK-NEXT: v33 = PropGet v3 key="push"
// CHECK-NEXT: v34 = Convert v32 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v35 = PropGet v34 key="constructor"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|function site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: v37 = PropGet v36 key="name"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: v39 = Call v33, v3, v38 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v40 = Convert v39 declared={type=number site=[[w_16]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: v41 = Increment v22
// CHECK-NEXT: v42 = Convert v41 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Jump -> next b2(v42)
// CHECK-NEXT: b15(v43):
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b16():
// CHECK-NEXT: v44 = Builtin builtin=GlobalThis
// CHECK-NEXT: v45 = PropGet v44 key="console" [isFreeName]
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v46 key="log"
// CHECK-NEXT: v48 = Convert v47 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v49 = PropGet v3 key="join"
// CHECK-NEXT: v50 = String string=" | "
// CHECK-NEXT: v51 = Call v49, v3, v50 calleeKey="join" calleeName="out.join"
// CHECK-NEXT: v52 = Convert v51 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v53 = Call v48, v46, v0, v52 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v54 = Undefined
// CHECK-NEXT: Return v54
// CHECK-NEXT: }
