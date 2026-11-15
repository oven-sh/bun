// STATISTIC: ImageFunctionsEmitted <= 20
const count = Number(process.env.MADE_UP_COUNT || 0);
process.env.MADE_UP_COUNT = String(count + 1);
console.log(process.env.MADE_UP_COUNT);
