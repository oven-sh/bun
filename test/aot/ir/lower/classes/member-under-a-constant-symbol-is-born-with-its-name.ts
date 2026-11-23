// RUN: lower
// The record of the function spells the name, and the operation that names it stays: the run time holds the two against each other.
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-COUNT-4: SetFunctionName

// RUN(HEADERS): lower
// HEADERS: function {{*}}name="[near]" {{*}}kind=Method flags=[{{*}}IsNamedByComputedKey
// HEADERS: function {{*}}name="" {{*}}kind=Method flags=[{{*}}IsNamedByComputedKey
// HEADERS: function {{*}}name="[shared]" {{*}}kind=Getter flags=[{{*}}IsNamedByComputedKey

// RUN(UNKNOWN): lower
// UNKNOWN-NOT: name="[loose]"

const near = Symbol("near");
const bare = Symbol();
const shared = Symbol.for("shared");
let loose = Symbol("loose");
loose = Symbol("loosened");

export class Named {
  [near]() {
    return 1;
  }
  [bare]() {
    return 2;
  }
  get [shared]() {
    return 3;
  }
  [loose]() {
    return 4;
  }
}
