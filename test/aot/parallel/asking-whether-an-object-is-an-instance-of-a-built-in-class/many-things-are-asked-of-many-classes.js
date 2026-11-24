// STATISTIC: ImageFunctionsEmitted <= 60
const things = [{}, () => 1, new Set(), [], new Map(), /x/, new Date(0), Promise.resolve(), new Error("made up"), new Uint8Array(1), Object.create(null), 1, "text", null, undefined];
for (const thing of things)
  console.log(thing instanceof Function, thing instanceof Set, thing instanceof Array, thing instanceof Map, thing instanceof RegExp, thing instanceof Date, thing instanceof Promise, thing instanceof Error, thing instanceof Uint8Array, thing instanceof Object);
