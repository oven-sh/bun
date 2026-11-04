let calls = 0;
class Later { constructor(value) { this.value = value; } then(resolve) { calls++; resolve("T" + this.value); } }
const held = new Map(); for (let i = 0; i < 40; i++) held.set(i, new Later(i));
Promise.all(held).then((all) => { let t = 0; for (const pair of all) t += pair[0] + pair[1].value; console.log(calls, all.length, t); });
