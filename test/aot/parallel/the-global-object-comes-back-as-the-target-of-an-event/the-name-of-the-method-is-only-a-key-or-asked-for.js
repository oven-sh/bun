// A control: the text stands as the key of a call on its target, and left of `in`.
// STATISTIC: FunctionsLowered <= 1000
const { signal } = new AbortController();
console.log("addEventListener" in signal, signal["dispatchEvent"](new Event("ping")));
