
// RUN(SITES): lower
// SITES: [[result]] = Call
// SITES-NEXT: PutModuleVariable [[result]]

// A variable without an annotation that is stored to once is untyped: what its initializer gives is stored as it is.

function g() {
  return 1;
}

export let v = g();
