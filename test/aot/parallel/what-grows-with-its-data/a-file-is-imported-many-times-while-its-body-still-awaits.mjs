// Sizes: 4000 16000 64000
// Passes: 1
// Grows: linear
const size = Number(process.env.SIZE ?? 100), passes = Number(process.env.PASSES ?? 1);
const asked = [];
for (let pass = 0; pass < passes; pass++)
  for (let i = 0; i < size; i++) asked.push(import("./a-file-is-imported-many-times-while-its-body-still-awaits.mjs"));
Promise.all(asked).then(all => console.log(all.length, all.every(each => each.mark === "here")));
await 0;
export const mark = "here";
