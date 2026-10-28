const programs = {
  0: () => import("./look-alikes.ts"),
  1: () => import("./beside.js"),
};
await programs[process.argv[2]]();
