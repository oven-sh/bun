// A `--define` whose value is `__dirname` makes a TypeScript file without imports and exports a CommonJS file, whose code is not strict.
// Flags: --define DIR=__dirname
declare const DIR: string;
console.log(
  typeof DIR,
  (function (this: unknown) {
    return this === undefined;
  })(),
);
