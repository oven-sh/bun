import { isDeepStrictEqual } from "node:util";
console.log(isDeepStrictEqual({ a: [1.5] }, { a: [1.5] }), isDeepStrictEqual({ a: 1 }, { a: "1" }), isDeepStrictEqual(new Map([[1, 2]]), new Map([[1, 2]])));
