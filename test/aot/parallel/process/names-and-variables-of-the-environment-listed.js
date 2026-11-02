// The names of the environment are listed and its variables are copied. Nothing else of the library is compiled for that.
// STATISTIC: ImageFunctionsEmitted <= 20
console.log(Object.keys(process.env).length > 0, typeof { ...process.env }.PATH !== "object");
