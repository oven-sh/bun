// Flags: --aot-harden=proof-checks
// STATISTIC: FreshResultsChecked >= 1
const words: string[][] = JSON.parse(process.env.MADE_UP_WORDS ?? '[["b"],["a"],["c"]]');
let total = 0;
for (let i = 0; i < 2000; i++) total += words.flat().length;
console.log(total, JSON.stringify(words.flat()));
