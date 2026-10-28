// BUN_JSC_useExplicitResourceManagement=0 takes the global SuppressedError away. The program asks one thing, so nothing else in it says that the name is used.
// IR+ ^ +v\d+.* = GetGlobalBinding key="SuppressedError"
// IR- ^ +v\d+.* = Builtin builtin=SuppressedError @
console.log(typeof SuppressedError);
