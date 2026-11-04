// BUN_JSC_useSharedArrayBuffer=0 takes the global SharedArrayBuffer away. The program asks one thing, so nothing else in it says that the name is used.
// IR+ ^ +v\d+.* = GetGlobalBinding key="SharedArrayBuffer"
// IR- ^ +v\d+.* = Builtin builtin=SharedArrayBuffer @
// Env: BUN_JSC_useSharedArrayBuffer=0
console.log(typeof SharedArrayBuffer);
