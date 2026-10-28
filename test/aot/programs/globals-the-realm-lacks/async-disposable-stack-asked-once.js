// BUN_JSC_useExplicitResourceManagement=0 takes the global AsyncDisposableStack away. The program asks one thing, so nothing else in it says that the name is used.
// IR+ ^ +v\d+.* = GetGlobalBinding key="AsyncDisposableStack"
// IR- ^ +v\d+.* = Builtin builtin=AsyncDisposableStack @
console.log(typeof AsyncDisposableStack);
