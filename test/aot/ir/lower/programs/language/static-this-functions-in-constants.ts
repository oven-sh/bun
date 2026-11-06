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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b16():
// CHECK-NEXT: v1 = Call v0 calleeName="run"
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Promise" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v5 = InstanceOf v1, v4 writtenExpression="r instanceof Promise"
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v7) handler=b16():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b16():
// CHECK-NEXT: v8 = String string="a promise"
// CHECK-NEXT: Jump -> next b15(v8)
// CHECK-NEXT: b5(v9) handler=b16():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b16():
// CHECK-NEXT: v10 = Builtin builtin=Array
// CHECK-NEXT: v11 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v12 = Call v11, v10, v1 calleeName="Array.isArray"
// CHECK-NEXT: v13 = Convert v12 declared={type=boolean site=[[w_4]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = ToBoolean v13
// CHECK-NEXT: Branch v14 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v15) handler=b16():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b16():
// CHECK-NEXT: v16 = String string="array "
// CHECK-NEXT: v17 = Builtin builtin=JSON
// CHECK-NEXT: v18 = PropGet v17 key="stringify"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v20 = Convert v1 declared={type=undefined|null|Array} illTypedCause=Assertion
// CHECK-NEXT: v21 = Call v19, v17, v20 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = Add v16, v22
// CHECK-NEXT: Jump -> next b15(v23)
// CHECK-NEXT: b9(v24) handler=b16():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b16():
// CHECK-NEXT: v25 = Builtin builtin=ArrayBuffer
// CHECK-NEXT: v26 = Builtin builtin=ArrayBufferIsView
// CHECK-NEXT: v27 = Call v26, v25, v1 calleeName="ArrayBuffer.isView"
// CHECK-NEXT: v28 = Convert v27 declared={type=boolean site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v29 = ToBoolean v28
// CHECK-NEXT: Branch v29 -> taken b11(| 0), notTaken b13(| 0)
// CHECK-NEXT: b11(v30) handler=b16():
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12() handler=b16():
// CHECK-NEXT: v31 = String string="a view "
// CHECK-NEXT: v32 = Convert v1 declared={type=undefined|null|TypedArray flags=[IsExpected]}
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|object site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v34 = PropGet v33 key="constructor"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|function site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v36 = PropGet v35 key="name"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|string site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v38 = Add v31, v37
// CHECK-NEXT: Jump -> next b15(v38)
// CHECK-NEXT: b13(v39) handler=b16():
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14() handler=b16():
// CHECK-NEXT: v40 = TypeOf v1
// CHECK-NEXT: v41 = String string=" "
// CHECK-NEXT: v42 = Add v40, v41
// CHECK-NEXT: v43 = Builtin builtin=String
// CHECK-NEXT: v44 = Call v43, -, v1 calleeName="String"
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v46 = Add v42, v45
// CHECK-NEXT: Jump -> next b15(v46)
// CHECK-NEXT: b15(v47) handler=b16():
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v48
// CHECK-NEXT: b16() role=CatchHandler:
// CHECK-NEXT: v49 = CatchValue
// CHECK-NEXT: v50 = Builtin builtin=GlobalThis
// CHECK-NEXT: v51 = PropGet v50 key="TypeError" [isFreeName]
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v53 = InstanceOf v49, v52 writtenExpression="e instanceof TypeError"
// CHECK-NEXT: v54 = ToBoolean v53
// CHECK-NEXT: Branch v54 -> taken b17(| 0), notTaken b19(| 0)
// CHECK-NEXT: b17(v55):
// CHECK-NEXT: Jump -> next b18()
// CHECK-NEXT: b18():
// CHECK-NEXT: v56 = String string="TypeError"
// CHECK-NEXT: Jump -> next b21(v56)
// CHECK-NEXT: b19(v57):
// CHECK-NEXT: Jump -> next b20()
// CHECK-NEXT: b20():
// CHECK-NEXT: v58 = String string="another error"
// CHECK-NEXT: Jump -> next b21(v58)
// CHECK-NEXT: b21(v59):
// CHECK-NEXT: v60 = Convert v59 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v60
// CHECK-NEXT: }
