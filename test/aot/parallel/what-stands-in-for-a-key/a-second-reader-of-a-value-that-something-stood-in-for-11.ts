async function f(list: number[], t: any) { var key: any; try { for (key in list) await t[key](); } catch { return typeof key; } }
console.log(await f(JSON.parse("[7,8]"), { 0() {}, 1() { throw 0; } })); export {};
