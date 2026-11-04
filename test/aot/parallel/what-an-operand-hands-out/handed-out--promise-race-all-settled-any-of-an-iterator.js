let calls = 0;
class Later { constructor(value) { this.value = value; } then(resolve) { calls++; resolve("T" + this.value); } }
const list = []; for (let i = 0; i < 10; i++) list.push(new Later(i));
Promise.allSettled(list.values()).then((all) => { console.log(calls, all.length, all[7].status, all[7].value.length); return Promise.any(new Set(list).values()); }).then((one) => { console.log(calls, one.length); return Promise.race(list.values()); }).then((one) => { console.log(calls, one.length); });
