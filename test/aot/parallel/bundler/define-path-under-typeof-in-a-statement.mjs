// A statement that is `typeof` of a `--define` whose value is a path below a const of the file reads nothing, because nothing takes its value: the getter at the end of the path does not run.
// Flags: --define ROOT=holder.value
const holder = {
  get value() {
    console.log("the getter ran");
    return 1;
  },
};
typeof ROOT;
console.log("end");
