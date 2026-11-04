let calls = 0;
class Later { constructor(value) { this.value = value; } then(resolve) { calls++; resolve("T" + this.value); } }
const list = []; for (let i = 0; i < 40; i++) list.push(new Later(i));
Promise.all(list.values()).then((all) => { let t = 0; for (const text of all) t += text.length; console.log(calls, all.length, t, all[7]); });
