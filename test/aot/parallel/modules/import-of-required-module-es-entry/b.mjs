import("./mid.mjs").then(it => { globalThis.first = it; seen.push("first " + it.value); });
import("./mid.mjs").then(it => seen.push("second " + it.value + " " + (it === globalThis.first)));
Promise.resolve().then(() => seen.push("a job"));
