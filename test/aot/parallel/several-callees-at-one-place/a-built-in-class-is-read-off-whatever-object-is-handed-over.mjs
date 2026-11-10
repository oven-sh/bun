function get(o) { return o.Map; } function all(o) { return Object.getOwnPropertyNames(o).includes("WeakRef"); } console.log(typeof get(globalThis), all(globalThis), typeof get(Function.prototype));
