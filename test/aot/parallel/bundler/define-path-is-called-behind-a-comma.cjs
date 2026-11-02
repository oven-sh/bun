// A call of a name whose `--define` value is a path calls the member without its holder wherever the name is not the callee itself: behind a comma, as a branch of `?:`, behind `&&`, `||` or `??`, and as the tag of a template behind a comma. Out of an array literal the member is called on the array. The path written there does the same, and a path below a `const` of the file is called as a path of globals is. `bun run` prints the path alone in front of the arguments where the other operands do nothing, and calls it on its holder. Plain Bun prints another output.
// Flags: --define BOUND=holder.m --define FREE=shared.m
"use strict";
function m() {
  const isHolder = this === holder || this === globalThis.shared;
  return isHolder ? "the holder" : this === undefined ? "no receiver" : "another receiver";
}
const holder = { m };
globalThis.shared = { m };
let effects = 0;
const effect = () => effects++;
console.log(
  [
    (0, BOUND)(),
    (void 0, BOUND)(),
    (0, 0, BOUND)(),
    (BOUND, BOUND)(),
    (1 ? BOUND : 0)(),
    (true && BOUND)(),
    (null ?? BOUND)(),
    [BOUND][0](),
    (0, BOUND)?.(),
    (0, BOUND)`tagged`,
    (effect(), BOUND)(),
    (BOUND || 0)(),
    BOUND(),
    effects,
  ].join(),
);
console.log(
  [
    (0, FREE)(),
    (void 0, FREE)(),
    (0, 0, FREE)(),
    (FREE, FREE)(),
    (1 ? FREE : 0)(),
    (true && FREE)(),
    (null ?? FREE)(),
    [FREE][0](),
    (0, FREE)?.(),
    (0, FREE)`tagged`,
    (effect(), FREE)(),
    (FREE || 0)(),
    FREE(),
    effects,
  ].join(),
);
/* Output:
no receiver,no receiver,no receiver,no receiver,no receiver,no receiver,no receiver,another receiver,no receiver,no receiver,no receiver,no receiver,the holder,1
no receiver,no receiver,no receiver,no receiver,no receiver,no receiver,no receiver,another receiver,no receiver,no receiver,no receiver,no receiver,the holder,2
*/
