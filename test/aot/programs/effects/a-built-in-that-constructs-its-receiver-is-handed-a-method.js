// TypedArray.of constructs its receiver. A method is no constructor: the call throws, and nothing ever enters the method, so the compiler drops its body and has no summary of it.
const TypedArray = Object.getPrototypeOf(Int8Array);
const m = { m() {} }.m;
try { TypedArray.of.call(m, []); console.log("no throw"); } catch (e) { console.log("threw", e instanceof TypeError, String(e).slice(0, 60)); }
try { Int8Array.of.call(m, 1, 2); console.log("no throw"); } catch (e) { console.log("threw", e instanceof TypeError); }
try { console.log(Int8Array.of.call(Uint8Array, 1, 300).join()); } catch (e) { console.log("threw", String(e)); }
