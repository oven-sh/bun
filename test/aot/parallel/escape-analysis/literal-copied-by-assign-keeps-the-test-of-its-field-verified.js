// A literal is made only to be copied by Object.assign, so it is never allocated, and the test of `y` for the type of its field is left with two arms that only pass the value on.
// One of them names what was proven of the value behind the test. The field takes less than any value, so the test stays. The build verifies the program after every stage.
// Flags: --aot-check=verify-each-stage
class Above0 {
}
function make0() {
  return { n0value: [1, 2] };
}
function change0(loose, y) {
  Object.assign(loose, { n0value: y });
}
function run0(y, turn) {
  const o = make0(turn);
  change0(o, y);
}
for (let round = 0;round < 3; round++)
  for (const y of [!0, 2])
    try {
      run0(y, turn++);
    } catch (error) {}
function make3(turn) {}
function change3(loosey, turn) {
  for (let round = 0;round < 1; round++)
    ;
}
function read4(held) {}
console.log("done");
