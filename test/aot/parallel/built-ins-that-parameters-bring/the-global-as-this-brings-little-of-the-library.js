// STATISTIC: ImageFunctionsEmitted <= 8
function g() { return this.Map; } console.log(typeof g.call(globalThis), new (g.call(globalThis))([[1, 2]]).get(1));
