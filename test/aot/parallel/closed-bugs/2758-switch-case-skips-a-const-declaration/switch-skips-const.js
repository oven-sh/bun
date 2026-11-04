// A `switch` that enters behind `case 0` never runs `const x = "set"`, so a closure made in a later case reads `x` in its dead zone: a ReferenceError, as the language says.
// `bun run` prints the value in place of each read, and so did executables before: `1 set`, `2 set`.
function pick(n) {
  switch (n) {
    case 0:
      const x = "set";
      return () => x;
    case 1:
      const read = () => x;
      return read;
    default: {
      const inner = () => () => x;
      return inner();
    }
  }
}
for (const n of [0, 1, 2]) {
  try {
    console.log(n, pick(n)());
  } catch (error) {
    console.log(n, error.name);
  }
}
/* Output:
0 set
1 ReferenceError
2 ReferenceError
*/
