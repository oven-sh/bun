// Bun.inspect() walks the global object in the one module that runs. The three others hand Bun to native code, look up a host and print a class.
const programs = {
  0: () => import("./p0.js"),
  6: () => import("./p6.js"),
  8: () => import("./p8.js"),
  18: () => import("./p18.ts"),
};
await programs[process.argv[2] ?? 0]();
