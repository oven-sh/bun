// The key may spell a member of Array.prototype or Object.prototype alone: the functions of other classes stay out of the executable.
// STATISTIC: ImageFunctionsEmitted <= 46
console.log(typeof ([1, 2] as any)[JSON.parse('"at"')]);
