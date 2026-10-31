// An object of another class with the same members, one of them an accessor, stands where an instance of a class is declared.
const programs = {
  0: () => import("./look-alikes.ts"),
  1: () => import("./beside.js"),
};
await programs[process.argv[2] ?? 0]();
