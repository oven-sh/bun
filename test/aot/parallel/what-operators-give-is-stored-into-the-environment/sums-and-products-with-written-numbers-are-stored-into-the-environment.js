// What each operator gives beside a written number is stored as a text, without a warning.
// STATISTIC: ImageFunctionsEmitted <= 30
// Env: BUN_OPTIONS=--pending-deprecation
const four = JSON.parse("4");
const word = JSON.parse('"a"');
process.env.MADE_UP_SUM = four + 1;
process.env.MADE_UP_TEXT = word + 1;
process.env.MADE_UP_PRODUCT = four * 2;
process.env.MADE_UP_BITS = four | 1;
process.env.MADE_UP_NOTHING = word * 2;
console.log(process.env.MADE_UP_SUM, process.env.MADE_UP_TEXT, process.env.MADE_UP_PRODUCT, process.env.MADE_UP_BITS, process.env.MADE_UP_NOTHING, typeof process.env.MADE_UP_SUM);
