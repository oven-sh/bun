// An `.mjs` file is an ES module, which has neither `module` nor `exports`. A statement that does nothing but read a name whose `--define` value is a path below one of them is left out of the executable, as `bun run` leaves it out: a read of the path there throws a ReferenceError.
// Flags: --define ME=module.exports --define EK=exports.k
ME;
void ME;
!ME;
(ME, 1);
if (ME) {
}
EK;
console.log("end");
