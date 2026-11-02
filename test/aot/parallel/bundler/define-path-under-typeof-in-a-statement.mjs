// A statement that is `typeof` of a name whose `--define` value is a path below a const of the file reads the path, as `typeof holder.value` does there: the getter at the end of the path runs. `bun run` leaves the statement out where a define puts the path in it. Plain Bun prints another output.
// Flags: --define ROOT=holder.value
const holder = {
  get value() {
    console.log("the getter ran");
    return 1;
  },
};
typeof ROOT;
console.log("end");
/* Output:
the getter ran
end
*/
