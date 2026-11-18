// This program stopped the build ("the program enters functions of Bun's library that the load has left out"): the load names the key by its binding, also through a pattern and through another name of Symbol;
// the read off Symbol gave "some symbol", and the read under it counted as one under a key that nobody knows.
// STATISTIC: ImageFunctionsEmitted <= 10
const { iterator: stepsKey } = Symbol;
const Marks = Symbol;
function firstOf(list) { return list[stepsKey]().next().value; }
function secondOf(list) { const walk = list[Marks.iterator](); walk.next(); return walk.next().value; }
console.log(firstOf([7, 8]), firstOf(new Set([6])), firstOf("xy"), secondOf([7, 8]));
