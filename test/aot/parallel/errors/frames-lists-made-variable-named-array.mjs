// What a stack trace lists where a list is made with a length that is refused, through a variable of the program that is named Array.
const framesIn = stack => String(stack).split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/(?:[A-Z]:)?[\\/].*[\\/]/, "").replace(/native:\d+:\d+/, "native")).join(" < ");
const Array = globalThis.Array;
const rows = {
  moduleCall(n) { const made = Array(n); return [made]; },
  moduleNew(n) { const made = new Array(n); return [made]; },
  moduleCallFilled(n) { const made = Array(n).fill(0); return [made]; },
  moduleNewFilled(n) { const made = new Array(n).fill(0); return [made]; },
  localCall(n) { const Array = globalThis.Array; const made = Array(n); return [made, Array]; },
  localNew(n) { const Array = globalThis.Array; const made = new Array(n); return [made, Array]; },
  localLetCall(n) { let Array = globalThis.Array; const made = Array(n); return [made, Array]; },
  localLetNew(n) { let Array = globalThis.Array; const made = new Array(n); return [made, Array]; },
  capturedCall(n) { const Array = globalThis.Array; return [(() => { const made = Array(n); return [made]; })(), Array]; },
  capturedNew(n) { const Array = globalThis.Array; return [(() => { const made = new Array(n); return [made]; })(), Array]; },
  localAlsoCapturedCall(n) { const Array = globalThis.Array; const read = () => Array; const made = Array(n); return [made, read]; },
  parameterCall(n, Array = globalThis.Array) { const made = Array(n); return [made]; },
  parameterNew(n, Array = globalThis.Array) { const made = new Array(n); return [made]; },
  destructuredCall(n) { const { Array } = globalThis; const made = Array(n); return [made, Array]; },
  destructuredNew(n) { const { Array } = globalThis; const made = new Array(n); return [made, Array]; },
  otherValueNew(n) { const Array = globalThis.Uint8Array; const made = new Array(n); return [made, Array]; },
  otherValueCall(n) { const Array = globalThis.ArrayBuffer; const made = new Array(n); return [made, Array]; },
};
for (const [name, row] of Object.entries(rows)) {
  let shown;
  try { shown = String(row(-1)).slice(0, 20); } catch (error) { shown = `${error.name} at ${error.line}:${error.column} < ${framesIn(error.stack)}`; }
  console.log(`${name}: ${shown}`);
}
try { const made = Array(-1); console.log(made); } catch (error) { console.log("top call: " + framesIn(error.stack)); }
try { const made = new Array(-1); console.log(made); } catch (error) { console.log("top new: " + framesIn(error.stack)); }
/* Output:
moduleCall: RangeError at 5:32 < Array (unknown) < moduleCall (frames-lists-made-variable-named-array.mjs:5:32) < frames-lists-made-variable-named-array.mjs:25:24
moduleNew: RangeError at 6:35 < Array (unknown) < moduleNew (frames-lists-made-variable-named-array.mjs:6:35) < frames-lists-made-variable-named-array.mjs:25:24
moduleCallFilled: RangeError at 7:38 < Array (unknown) < moduleCallFilled (frames-lists-made-variable-named-array.mjs:7:38) < frames-lists-made-variable-named-array.mjs:25:24
moduleNewFilled: RangeError at 8:41 < Array (unknown) < moduleNewFilled (frames-lists-made-variable-named-array.mjs:8:41) < frames-lists-made-variable-named-array.mjs:25:24
localCall: RangeError at 9:63 < Array (unknown) < localCall (frames-lists-made-variable-named-array.mjs:9:63) < frames-lists-made-variable-named-array.mjs:25:24
localNew: RangeError at 10:66 < Array (unknown) < localNew (frames-lists-made-variable-named-array.mjs:10:66) < frames-lists-made-variable-named-array.mjs:25:24
localLetCall: RangeError at 11:64 < Array (unknown) < localLetCall (frames-lists-made-variable-named-array.mjs:11:64) < frames-lists-made-variable-named-array.mjs:25:24
localLetNew: RangeError at 12:67 < Array (unknown) < localLetNew (frames-lists-made-variable-named-array.mjs:12:67) < frames-lists-made-variable-named-array.mjs:25:24
capturedCall: RangeError at 13:83 < Array (unknown) < <anonymous> (frames-lists-made-variable-named-array.mjs:13:83) < capturedCall (frames-lists-made-variable-named-array.mjs:13:105) < frames-lists-made-variable-named-array.mjs:25:24
capturedNew: RangeError at 14:86 < Array (unknown) < <anonymous> (frames-lists-made-variable-named-array.mjs:14:86) < capturedNew (frames-lists-made-variable-named-array.mjs:14:108) < frames-lists-made-variable-named-array.mjs:25:24
localAlsoCapturedCall: RangeError at 15:101 < Array (unknown) < localAlsoCapturedCall (frames-lists-made-variable-named-array.mjs:15:101) < frames-lists-made-variable-named-array.mjs:25:24
parameterCall: RangeError at 16:61 < Array (unknown) < parameterCall (frames-lists-made-variable-named-array.mjs:16:61) < frames-lists-made-variable-named-array.mjs:25:24
parameterNew: RangeError at 17:64 < Array (unknown) < parameterNew (frames-lists-made-variable-named-array.mjs:17:64) < frames-lists-made-variable-named-array.mjs:25:24
destructuredCall: RangeError at 18:68 < Array (unknown) < destructuredCall (frames-lists-made-variable-named-array.mjs:18:68) < frames-lists-made-variable-named-array.mjs:25:24
destructuredNew: RangeError at 19:71 < Array (unknown) < destructuredNew (frames-lists-made-variable-named-array.mjs:19:71) < frames-lists-made-variable-named-array.mjs:25:24
otherValueNew: RangeError at 20:76 < Uint8Array (unknown) < otherValueNew (frames-lists-made-variable-named-array.mjs:20:76) < frames-lists-made-variable-named-array.mjs:25:24
otherValueCall: RangeError at 21:78 < ArrayBuffer (unknown) < otherValueCall (frames-lists-made-variable-named-array.mjs:21:78) < frames-lists-made-variable-named-array.mjs:25:24
top call: Array (unknown) < frames-lists-made-variable-named-array.mjs:28:20
top new: Array (unknown) < frames-lists-made-variable-named-array.mjs:29:24
*/
