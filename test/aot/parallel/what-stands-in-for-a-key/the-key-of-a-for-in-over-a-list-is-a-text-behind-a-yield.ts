function* g(list: number[], table: any): any { var key: any; try { for (key in list) yield table[key](); } catch { yield typeof key; } }
console.log([...g(JSON.parse("[7,8]"), { 0() { return 5; }, 1() { throw 0; } })].join());
export {};
