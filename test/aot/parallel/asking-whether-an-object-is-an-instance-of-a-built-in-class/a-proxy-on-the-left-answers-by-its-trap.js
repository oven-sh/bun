// STATISTIC: ImageFunctionsEmitted <= 60
const asked = [];
const proxy = new Proxy({}, { getPrototypeOf(target) { asked.push("asked"); return Set.prototype; } });
console.log(proxy instanceof Set, proxy instanceof Function, asked.join());
