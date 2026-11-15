function f(list: number[], t: any) { var key: any; try { for (key in list) t[key] = 1; } catch { return typeof key + key; } }
console.log(f(JSON.parse("[7,8]"), { set 1(v: any) { throw 0; } }));
export {};
