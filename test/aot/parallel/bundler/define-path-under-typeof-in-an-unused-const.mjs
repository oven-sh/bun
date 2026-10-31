// A const that nothing reads still takes `typeof` of a `--define` whose value is a path below a const of the file: the getter at the end of the path runs.
// Flags: --define ROOT=holder.value
const holder = {
  get value() {
    console.log("the getter ran");
    return 1;
  },
};
const unused = typeof ROOT;
console.log("end");
