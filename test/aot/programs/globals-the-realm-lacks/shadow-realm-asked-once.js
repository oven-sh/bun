// BUN_JSC_useShadowRealm=0 takes the global ShadowRealm away. The program asks one thing, so nothing else in it says that the name is used.
// IR+ ^ +v\d+.* = GetGlobalBinding key="ShadowRealm"
// IR- ^ +v\d+.* = Builtin builtin=ShadowRealm @
console.log(typeof ShadowRealm);
