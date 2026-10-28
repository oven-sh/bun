// BUN_JSC_useTemporal=0 takes the global Temporal away. The program asks one thing, so nothing else in it says that the name is used.
// IR+ ^ +v\d+.* = GetGlobalBinding key="Temporal"
// IR- ^ +v\d+.* = Builtin builtin=Temporal @
console.log(typeof Temporal);
