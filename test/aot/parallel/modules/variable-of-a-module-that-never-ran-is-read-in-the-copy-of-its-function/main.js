const programs = {
  0: () => import("./p0.ts"),
  1: () => import("./p1.js"),
  2: () => import("./p2.ts"),
  3: () => import("./p3.ts"),
};
await programs[process.argv[2] ?? 0]();
