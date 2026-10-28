// BUN_JSC_useWasm=0 takes the global WebAssembly away. The program asks one thing, so nothing else in it says that the name is used.
// IR+ ^ +v\d+.* = GetGlobalBinding key="WebAssembly"
// IR- ^ +v\d+.* = Builtin builtin=WebAssembly @
console.log(typeof WebAssembly);
