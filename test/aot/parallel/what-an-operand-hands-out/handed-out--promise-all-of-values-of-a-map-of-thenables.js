let calls = 0;
class Later { constructor(value) { this.value = value; } then(resolve) { calls++; resolve("T" + this.value); } }
const held = new Map(); for (let i = 0; i < 40; i++) held.set(i, new Later(i));
Promise.all(held.values()).then((all) => { let t = 0; for (const text of all) t += text.length; console.log(calls, all.length, t, all[7]); });
