const o = { a: 1 };
console.log(Object.keys(...[o]).join(), Object.hasOwn(...[o, "a"]), o.hasOwnProperty(...["a"]), Reflect.get(...[o, "a"]), JSON.stringify(...[o]), Array.isArray(...[[1]]), Object.assign(...[{}, o]).a);
export {};
