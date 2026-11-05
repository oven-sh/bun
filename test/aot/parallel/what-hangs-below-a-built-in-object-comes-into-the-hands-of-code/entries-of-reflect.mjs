const all = Object.fromEntries(Reflect.ownKeys(Reflect).filter(k => typeof k === "string").map(k => [k, Reflect[k]]));
console.log(all.has({ a: 1 }, "a"), all.ownKeys({ b: 1 }).join(), all.apply(Math.max, null, [1, 3]));
