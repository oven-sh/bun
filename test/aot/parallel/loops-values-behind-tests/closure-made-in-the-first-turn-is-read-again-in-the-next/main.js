// Flags: --aot-heat=everything-is-hot
// Found by a fuzzer, and kept whole: without the second program, which never runs, the loop of the first is compiled another way.
const programs = {
  0: () => import("./loop.ts"),
  2: () => import("./other/main.js"),
};
await programs[process.argv.length > 9 ? 2 : 0]();
