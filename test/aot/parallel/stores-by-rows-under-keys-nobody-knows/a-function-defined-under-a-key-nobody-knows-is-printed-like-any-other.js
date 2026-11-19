// The twin by syntax, `shelf[key] = f`, brings nothing of the library either.
// STATISTIC: ImageFunctionsEmitted <= 20
const shelf = { count: 0 };
Object.defineProperty(shelf, JSON.parse('"a"'), { value: () => 1, enumerable: true });
console.log(shelf);
