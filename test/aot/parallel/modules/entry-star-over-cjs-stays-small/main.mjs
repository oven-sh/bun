// The entry point passes on the names of a CommonJS file with a star. Bun reads `default` and `then` on the namespace object of the entry point: a star passes on no `default`, so no server starts, and `then` is looked for among the names of the file. The executable holds the two files and what prints a line.
// STATISTIC: ImageFunctionsEmitted <= 12
export * from "./service.cjs";
