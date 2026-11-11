globalThis.runs = (globalThis.runs ?? "") + "auto "; export let v = 1; queueMicrotask(() => { v = 2; globalThis.runs = (globalThis.runs ?? "") + "stored "; });
