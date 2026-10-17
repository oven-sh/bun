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
