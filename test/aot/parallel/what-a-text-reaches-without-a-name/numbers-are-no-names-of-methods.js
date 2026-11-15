// A key that is a number by how it is written finds no method of the language.
// STATISTIC: FunctionsLowered <= 30
// STATISTIC: SourceFilesRuntime <= 12
const list = [5, 6, 7];
let sum = 0;
for (let i = 0; i < list.length; i++) sum += list[i];
let at = 0;
at += 1;
sum += list[at * 2] + list[list.length - 1];
console.log(sum);
