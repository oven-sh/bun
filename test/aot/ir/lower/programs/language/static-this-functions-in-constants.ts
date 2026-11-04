// RUN: lower
// OPTIONS: builtin-modules

// A static function that looks at `this`, held by a constant and called without it: all of Promise and the factories of typed arrays throw, Array.of and Array.from make a plain array. So it is wherever the call stands: at the top, in a function, in an arrow, as the last thing a function does.
function outcome(run: () => unknown): string { try { const r = run(); return r instanceof Promise ? "a promise" : Array.isArray(r) ? "array " + JSON.stringify(r) : ArrayBuffer.isView(r) ? "a view " + (r as object).constructor.name : typeof r + " " + String(r); } catch (e) { return e instanceof TypeError ? "TypeError" : "another error"; } }
const resolve: any = Promise.resolve, reject: any = Promise.reject, all: any = Promise.all, race: any = Promise.race, allSettled: any = Promise.allSettled, any_: any = Promise.any, withResolvers: any = (Promise as any).withResolvers;
const of: any = Array.of, from: any = Array.from;
const of8: any = Uint8Array.of, from8: any = Uint8Array.from, of64: any = Float64Array.of, from64: any = Float64Array.from, ofBig: any = BigInt64Array.of, fromClamped: any = Uint8ClampedArray.from;
const floor = Math.floor, keys = Object.keys, isArray = Array.isArray, fromCharCode = String.fromCharCode;
console.log("Promise.resolve", outcome(() => resolve(1)), "| reject", outcome(() => reject(1)), "| all", outcome(() => all([])), "| race", outcome(() => race([])), "| allSettled", outcome(() => allSettled([])), "| any", outcome(() => any_([])), "| withResolvers", outcome(() => withResolvers()));
console.log("Array.of", outcome(() => of(1, 2)), "| Array.from", outcome(() => from([1])));
console.log("Uint8Array.of", outcome(() => of8(1)), "| from", outcome(() => from8([1])), "| Float64Array.of", outcome(() => of64(1.5)), "| from", outcome(() => from64([1.5])), "| BigInt64Array.of", outcome(() => ofBig(1n)), "| Uint8ClampedArray.from", outcome(() => fromClamped([300])));
console.log("not the last thing:", outcome(() => { const r = of8(1); return r; }), "|", outcome(() => { const r = from64([1]); return r; }));
function declared(): unknown { return of8(1, 2); }
function declaredFrom(): unknown { const r = from8([1, 2]); return r; }
console.log("in declared functions:", outcome(declared), "|", outcome(declaredFrom));
let atTheTop = "";
try { atTheTop = String(of8(7).length); } catch (e) { atTheTop = e instanceof TypeError ? "TypeError" : "another error"; }
console.log("at the top:", atTheTop);
for (let round = 0; round < 3; round++) console.log("again", round, outcome(() => of8(round)), outcome(() => from8([round])), outcome(() => of(round)));
console.log("on their holders:", outcome(() => Uint8Array.of(1)), "|", outcome(() => Uint8Array.from([1])), "|", outcome(() => of8.call(Uint8Array, 1)), "|", outcome(() => of8.call(Float64Array, 1)), "|", outcome(() => from8.call(Int16Array, [1])), "|", outcome(() => of8.call(Array, 1)), "|", outcome(() => of8.call(undefined, 1)), "|", outcome(() => from8.call(null, [1])), "|", outcome(() => from8.call({}, [1])));
console.log("Math.floor", outcome(() => floor(1.5)), "| Object.keys", outcome(() => keys({ a: 1 })), "| Array.isArray", outcome(() => isArray([])), "| fromCharCode", outcome(() => fromCharCode(97)));

// GENERATED: outcome
// CHECK-LABEL: function {{*}}name="outcome"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b12():
// CHECK-NEXT: v1 = Call v0 calleeName="run"
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Promise" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v5 = InstanceOf v1, v4
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v7) handler=b12():
// CHECK-NEXT: v8 = String string="a promise"
// CHECK-NEXT: Jump -> next b11(v8)
// CHECK-NEXT: b3(v9) handler=b12():
// CHECK-NEXT: v10 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v11 = TypeTest v1 testedType=Array
// CHECK-NEXT: Branch v11 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v12) handler=b12():
// CHECK-NEXT: Jump -> next b7(v12)
// CHECK-NEXT: b5(v13) handler=b12():
// CHECK-NEXT: v14 = NarrowByTest v1, v13
// CHECK-NEXT: v15 = Builtin builtin=Array
// CHECK-NEXT: v16 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v17 = Call v16, v15, v14 calleeName="Array.isArray"
// CHECK-NEXT: v18 = Convert v17 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v19 = ToBoolean v18
// CHECK-NEXT: Branch v19 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v20) handler=b12():
// CHECK-NEXT: Jump -> next b7(v13)
// CHECK-NEXT: b7(v21) handler=b12():
// CHECK-NEXT: v22 = NarrowByTest v1, v21
// CHECK-NEXT: v23 = String string="array "
// CHECK-NEXT: v24 = Builtin builtin=JSON
// CHECK-NEXT: v25 = PropGet v24 key="stringify"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v26, v24, v22 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v29 = Add v23, v28
// CHECK-NEXT: Jump -> next b11(v29)
// CHECK-NEXT: b8(v30) handler=b12():
// CHECK-NEXT: v31 = Builtin builtin=ArrayBuffer
// CHECK-NEXT: v32 = Builtin builtin=ArrayBufferIsView
// CHECK-NEXT: v33 = Call v32, v31, v14 calleeName="ArrayBuffer.isView"
// CHECK-NEXT: v34 = Convert v33 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v35 = ToBoolean v34
// CHECK-NEXT: Branch v35 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v36) handler=b12():
// CHECK-NEXT: v37 = String string="a view "
// CHECK-NEXT: v38 = Convert v14 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v39 = PropGet v38 key="constructor"
// CHECK-NEXT: v40 = PropGet v39 key="name"
// CHECK-NEXT: v41 = Add v37, v40
// CHECK-NEXT: Jump -> next b11(v41)
// CHECK-NEXT: b10(v42) handler=b12():
// CHECK-NEXT: v43 = TypeOf v14
// CHECK-NEXT: v44 = String string=" "
// CHECK-NEXT: v45 = Add v43, v44
// CHECK-NEXT: v46 = Builtin builtin=String
// CHECK-NEXT: v47 = Call v46, -, v14 calleeName="String"
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v49 = Add v45, v48
// CHECK-NEXT: Jump -> next b11(v49)
// CHECK-NEXT: b11(v50) handler=b12():
// CHECK-NEXT: v51 = Convert v50 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v51
// CHECK-NEXT: b12() role=CatchHandler:
// CHECK-NEXT: v52 = CatchValue
// CHECK-NEXT: v53 = Builtin builtin=GlobalThis
// CHECK-NEXT: v54 = PropGet v53 key="TypeError" [isFreeName]
// CHECK-NEXT: v55 = Convert v54 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v56 = InstanceOf v52, v55
// CHECK-NEXT: v57 = ToBoolean v56
// CHECK-NEXT: Branch v57 -> taken b13(| 0), notTaken b14(| 0)
// CHECK-NEXT: b13(v58):
// CHECK-NEXT: v59 = String string="TypeError"
// CHECK-NEXT: Jump -> next b15(v59)
// CHECK-NEXT: b14(v60):
// CHECK-NEXT: v61 = String string="another error"
// CHECK-NEXT: Jump -> next b15(v61)
// CHECK-NEXT: b15(v62):
// CHECK-NEXT: v63 = Convert v62 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v63
// CHECK-NEXT: }
