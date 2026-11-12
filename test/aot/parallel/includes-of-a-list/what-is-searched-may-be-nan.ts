// What is searched may be NaN: the helper that looks for NaN reads the list under a number, so nothing that nobody names comes into the executable.
// STATISTIC: ImageFunctionsEmitted <= 4
const list = [1, 2];
console.log(list.includes(JSON.parse("1")));
