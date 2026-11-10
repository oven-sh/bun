// A delay that does not fit is warned of. The printer of warnings is compiled for that, and nothing else of the library.
// STATISTIC: ImageFunctionsEmitted <= 60
const delay: number = JSON.parse("1");
setTimeout(() => console.log("rang"), delay);
