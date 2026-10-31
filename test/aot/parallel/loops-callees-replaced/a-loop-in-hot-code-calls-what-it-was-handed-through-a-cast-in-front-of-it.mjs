// Flags: --aot-heat=everything-is-hot
// The loop calls what it was handed through a cast that stands in front of it. The build copies the loop for each function that it may be, and each copy has to know which: else it is copied again, without end.
function a(x) {
  return x + 1;
}
function b(x) {
  return x + 2;
}
const functions = [a, b];
function run(call) {
  let s = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      try {
        s += call(j);
      } catch (error) {
        s -= 1;
      }
    }
  return s;
}
console.log(
  run(x => a(x)),
  run(functions[1]),
  run(x => b(x)),
);
