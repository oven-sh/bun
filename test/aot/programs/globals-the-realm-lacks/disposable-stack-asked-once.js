// BUN_JSC_useExplicitResourceManagement=0 takes the global DisposableStack away. The program asks one thing, so nothing else in it says that the name is used.
// IR+ ^ +v\d+.* = GetGlobalBinding key="DisposableStack"
// IR- ^ +v\d+.* = Builtin builtin=DisposableStack @
console.log(typeof DisposableStack);
