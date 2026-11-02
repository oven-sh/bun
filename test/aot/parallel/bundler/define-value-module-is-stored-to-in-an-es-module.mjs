// In an ES module nothing declares `module` or `exports`, and a store to either name goes to the global object. Yet the build stops at a store to a name whose `--define` value is one of them, where a name whose value is any other global is stored to. `bun run` stores to the three globals.
// Flags: --define NAME=target --define MOD=module --define EXP=exports
globalThis.target = "the global";
globalThis.module = "the global";
globalThis.exports = "the global";
NAME = "stored";
MOD = "stored";
EXP = "stored";
console.log(globalThis.target, globalThis.module, globalThis.exports);
export {};
/* Plain Bun prints:
stored stored stored
*/
/* Build errors:
error: TS100050: --aot does not support --define MOD=module where MOD is stored to
error: TS100050: --aot does not support --define EXP=exports where EXP is stored to
*/
