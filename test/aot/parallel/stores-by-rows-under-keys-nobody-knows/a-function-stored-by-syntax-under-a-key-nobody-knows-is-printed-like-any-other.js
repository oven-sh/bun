// STATISTIC: ImageFunctionsEmitted <= 20
const shelf = { count: 0 };
shelf[JSON.parse('"a"')] = () => 1;
console.log(shelf);
