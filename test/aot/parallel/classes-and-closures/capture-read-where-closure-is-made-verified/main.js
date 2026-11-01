// Flags: --aot-check=verify-each-pass
// The closure captures one value, and all its calls are copied into the function that makes it: the captured value then stands for the closure and for each read of the capture.
// The capture is written as `number`, the value is the length of a string.
const programs = {
  0: () => import("./scene.ts"),
  1: () => import("./other.js"),
};
await programs[process.argv[2] ?? 0]();
