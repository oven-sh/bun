// RUN: link
// CHECK: typesite [[site]] module=[[entry]] {{*}}kind=Variable
// CHECK-NOT: text=
// CHECK: typesite
// CHECK: variable {{*}}name="v" module=[[entry]] declared={type=number|absent site=[[site]]}

// RUN(SITES): lower
// SITES: [[result]] = Call
// SITES-NEXT: [[converted]] = Convert [[result]] declared={type=number site=w{{*}}} @
// SITES-NEXT: PutModuleVariable [[converted]]

// A variable without an annotation has the type that the checker infers, and it is tested like a written one. Its site has no text.

function g() {
  return 1;
}

export let v = g();
