// %TypedArray%.of and Int8Array.of called on what is no constructor throw a TypeError; on another typed array constructor they make one of its kind.
const TypedArray = Object.getPrototypeOf(Int8Array);
const m = { m() {} }.m;
try { TypedArray.of.call(m, []); console.log("no throw"); } catch (e) { console.log("threw", e instanceof TypeError, String(e).slice(0, 60)); }
try { Int8Array.of.call(m, 1, 2); console.log("no throw"); } catch (e) { console.log("threw", e instanceof TypeError); }
try { console.log(Int8Array.of.call(Uint8Array, 1, 300).join()); } catch (e) { console.log("threw", String(e)); }
