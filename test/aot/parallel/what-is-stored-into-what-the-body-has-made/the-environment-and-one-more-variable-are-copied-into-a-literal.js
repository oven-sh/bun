// STATISTIC: ImageFunctionsEmitted <= 20
const more = { ...process.env, MADE_UP_COUNT: String(process.argv.length), MADE_UP_LIST: [1, 2] };
console.log(typeof more.MADE_UP_COUNT, more.MADE_UP_LIST.length);
