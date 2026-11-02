// A statement that does nothing but read a name whose `--define` value is a path below `module` or `exports` is left out of the executable, as `bun run` leaves it out. Such a path does not make a `.js` file a CommonJS file, and an ES module has neither name: a read of the path there throws a ReferenceError.
// Flags: --define ME=module.exports --define EK=exports.k
ME;
void ME;
!ME;
(ME, 1);
if (ME) {
}
EK;
console.log(
  "end",
  (function () {
    return typeof this;
  })(),
);
