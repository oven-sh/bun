// A store on the global object under a name that no built-in has replaces none: the program holds no other function of a name that it calls.
// STATISTIC: FunctionsLowered <= 60
globalThis.__DEV__ = true;
globalThis.count = (globalThis.count ?? 0) + 1;
globalThis["__VERSION__"] = [1, 2];
console.log(String(Temporal.PlainTime.from("12:30")), globalThis.__DEV__, globalThis.count, globalThis.__VERSION__.length);
