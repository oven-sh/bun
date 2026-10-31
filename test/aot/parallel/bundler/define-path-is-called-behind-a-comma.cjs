// A call of a name whose `--define` value is a path has the holder of its last name as `this` also where `bun run` prints the path alone in front of the arguments, as behind a comma whose other operands do nothing. Where it prints the operator, the member is called without a receiver.
// Flags: --define M=holder.m
"use strict";
const holder = {
  m() {
    return this === holder ? "the holder" : this === undefined ? "no receiver" : "another receiver";
  },
};
let effects = 0;
const effect = () => effects++;
console.log(
  [
    (0, M)(),
    (void 0, M)(),
    (0, 0, M)(),
    (M, M)(),
    (1 ? M : 0)(),
    (true && M)(),
    (null ?? M)(),
    [M][0](),
    (0, M)?.(),
    (0, M)`tagged`,
    (effect(), M)(),
    (M || 0)(),
    effects,
  ].join(),
);
