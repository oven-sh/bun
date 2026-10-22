const first = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
const result = Bun.JSON5.parse(first);
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
