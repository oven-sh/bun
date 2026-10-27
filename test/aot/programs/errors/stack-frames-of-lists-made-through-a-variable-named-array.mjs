// What a stack trace lists where a list is made with a length that is refused, through a variable of the program that is named Array.
const framesIn = stack => String(stack).split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/\/.*\//, "").replace(/native:\d+:\d+/, "native")).join(" < ");
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
