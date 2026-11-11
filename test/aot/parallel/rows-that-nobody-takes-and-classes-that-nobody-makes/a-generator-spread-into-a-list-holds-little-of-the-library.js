// STATISTIC: ImageFunctionsEmitted <= 24
function* count() { yield 1; yield 2; }
console.log([...count()].length);
