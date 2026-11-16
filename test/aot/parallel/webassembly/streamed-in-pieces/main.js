// The same bytes give the same module or the same error whether they are handed over at once or arrive in pieces of any size: whole modules, cut ones and ones with a byte changed.
// A size that continues in the next piece, or a payload that begins in one piece and ends in another, must be read as if the pieces were one.
// The output is stored: plain Bun has the same parser, so it would agree with a fault.
// STATISTIC: WasmOptimizedCopies = 33
// STATISTIC: WasmBaselineCopies = 56
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 35
// COUNTER in every build: WasmInstancesUsingImageCode = 0
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 7
import branchTables from "../branch-tables/module.wasm";
import bulkOperations from "../bulk-operations/module.wasm";
import exceptions from "../exceptions/tables.wasm";
import floatConstants from "../float-constants/module.wasm";
import severalMemories from "../several-memories/module.wasm";
import vectors from "../vectors/module.wasm";

const facts = module =>
  `module ${WebAssembly.Module.exports(module)
    .map(({ name, kind }) => name + ":" + kind)
    .join()} | ${WebAssembly.Module.imports(module).length}`;
// The constructor's message ends with the expression that was evaluated.
const said = error => `${error.constructor.name}: ${error.message.split(" (evaluating")[0]}`;
const atOnce = bytes => {
  try {
    return facts(new WebAssembly.Module(bytes));
  } catch (error) {
    return said(error);
  }
};
const inPieces = async (bytes, size) => {
  let offset = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, (offset += size)));
    },
  });
  try {
    return facts(await WebAssembly.compileStreaming(new Response(body, { headers: { "content-type": "application/wasm" } })));
  } catch (error) {
    return said(error);
  }
};

for (const [name, path] of Object.entries({ branchTables, bulkOperations, exceptions, floatConstants, severalMemories, vectors })) {
  const whole = new Uint8Array(await Bun.file(path).arrayBuffer());
  const inputs = [["whole", whole]];
  const step = Math.max(1, Math.floor(whole.length / 24));
  for (let place = 0; place < whole.length; place += step) {
    // A buffer of exactly its own size: under a sanitizer, a read past the end of the bytes is seen.
    inputs.push([`cut at ${place}`, whole.slice(0, place)]);
    const changed = whole.slice();
    changed[place] ^= 0x80;
    inputs.push([`changed at ${place}`, changed]);
  }
  let cases = 0;
  let modules = 0;
  const different = [];
  for (const [what, bytes] of inputs) {
    const expected = atOnce(bytes);
    if (expected.startsWith("module ")) modules++;
    for (const size of what === "whole" ? [1, 2, 3, 4, 5, 6, 7, 8, 13, 64, 1000] : [1, 3, 5, 64]) {
      cases++;
      const actual = await inPieces(bytes, size);
      if (actual !== expected) different.push(`${what}, pieces of ${size}: ${actual} | at once: ${expected}`);
    }
  }
  console.log(`${name}: ${inputs.length} inputs, ${modules} of them modules, ${cases} cases, ${different.length} differ`);
  for (const line of different.slice(0, 3)) console.log("  " + line);
}

/* Output:
branchTables: 51 inputs, 2 of them modules, 211 cases, 0 differ
bulkOperations: 51 inputs, 2 of them modules, 211 cases, 0 differ
exceptions: 51 inputs, 1 of them modules, 211 cases, 0 differ
floatConstants: 51 inputs, 11 of them modules, 211 cases, 0 differ
severalMemories: 51 inputs, 2 of them modules, 211 cases, 0 differ
vectors: 51 inputs, 2 of them modules, 211 cases, 0 differ
*/
