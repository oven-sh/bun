function f(list: number[], t: any) { var key: any; try { for (key in list) if (key in t) return 0; } catch { return typeof key + key; } }
console.log(f(JSON.parse("[7,8]"), new Proxy({}, { has(_, k) { if (k === "1") throw 0; return false; } })));
export {};
