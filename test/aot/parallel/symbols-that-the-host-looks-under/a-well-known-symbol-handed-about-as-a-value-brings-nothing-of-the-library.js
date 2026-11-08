// The symbol is passed to a function, so it is read as a value. It is a constant of the language and not the one that the host looks under.
// STATISTIC: ImageFunctionsEmitted <= 20
const judge = { count: 1 };
const lay = (holder, key) => { holder[key] = value => value === 1; };
lay(judge, Symbol.hasInstance);
console.log(1 instanceof judge, 2 instanceof judge, judge.count);
console.log({ kept: judge.count });
