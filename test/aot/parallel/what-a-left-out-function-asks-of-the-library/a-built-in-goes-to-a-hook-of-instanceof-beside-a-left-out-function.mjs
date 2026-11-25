// A built-in goes to a hook of instanceof, which asks it for a method by name, beside a function nobody calls.
// STATISTIC: FunctionsLowered <= 60
function never(from, key) { return from[key]; }
class Gate { static [Symbol.hasInstance](held) { return held.fromEntries([["a", 1]]).a === 1; } }
console.log("HOOK", Object instanceof Gate);
