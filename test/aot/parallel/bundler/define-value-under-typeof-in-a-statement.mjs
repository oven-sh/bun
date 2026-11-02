// A statement that is `typeof` of a name with a `--define` value throws a ReferenceError in the dead zone of the `const` that the value names, as `typeof` of that name does there. `bun run` leaves such a statement out. Plain Bun prints another output.
// Flags: --define NAME=target
console.log("start");
typeof NAME;
console.log("after");
const target = 1;
/* Output:
start
exit code 1
ReferenceError: Cannot access 'target' before initialization.
*/
