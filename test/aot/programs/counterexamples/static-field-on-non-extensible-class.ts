// Defining a static field on a class that its own initializer made non-extensible throws a TypeError.
try { class P { static a = Object.preventExtensions(P) && 1; } console.log(Object.keys(P).join()); } catch (e) { console.log((e as Error).name); }
