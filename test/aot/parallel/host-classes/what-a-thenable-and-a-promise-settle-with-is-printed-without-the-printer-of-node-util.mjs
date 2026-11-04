// What an await answers for a thenable is a value nobody knows. Printing it takes the printer of node:util only where something in the program may say itself how it is printed.
// STATISTIC: ImageFunctionsEmitted <= 100
const list = [{ then(f) { f(1); return 0; } }, Promise.resolve(2)];
for (const t of list) console.log(await t);
