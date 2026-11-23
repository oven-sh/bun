// RUN: lower
// JSC tests the object of an update by an operation of its own, which has a message of its own, ahead of the conversion of the key.
// CHECK-LABEL: function {{*}}name="compound"
// CHECK: b0([[a]]: {{*}}, [[k]]: anything):
// CHECK: = RequireObjectCoercible [[a]] nullishAccess=Update
// CHECK-NEXT: = TypeTest [[k]] testedType=object
// CHECK-NOT: RequireObjectCoercible
// CHECK: = ElemGet [[a]],
// `bun run` has the name of the constant there.
// CHECK-LABEL: function {{*}}name="knownToTheBuildAlone"
// CHECK: = RequireObjectCoercible [[a]] nullishAccess=Update
// CHECK-NEXT: = PropGet [[a]] key="p"
// CHECK-LABEL: function {{*}}name="logical"
// CHECK: = RequireObjectCoercible [[a]] nullishAccess=Update
// CHECK: = ElemGet [[a]],
// A key that is a number or a text once the build has printed the file has no such test.
// CHECK-LABEL: function {{*}}name="numberOrText"
// CHECK-NOT: RequireObjectCoercible
// A bundle that does not minify syntax prints a constant and a template as they are written, and JSC's parser finds neither a number nor a text there.
// CHECK-LABEL: function {{*}}name="printedAsWritten"
// CHECK: = RequireObjectCoercible [[a]] nullishAccess=Update
// CHECK-NEXT: = PropGet [[a]] key="p"
// CHECK: = RequireObjectCoercible [[a]] nullishAccess=Update
// CHECK-NEXT: = PropGet [[a]] key="p1"
// CHECK: = RequireObjectCoercible [[a]] nullishAccess=Update
// CHECK-NEXT: = PropGet [[a]] key="pqr"
// CHECK-LABEL: function {{*}}name="symbol"
// CHECK: = RequireObjectCoercible [[a]] nullishAccess=Update
// CHECK-NEXT: = PropGet [[a]] key=@@iterator
// CHECK-LABEL: function {{*}}name="update"
// CHECK: = RequireObjectCoercible [[a]] nullishAccess=Update
// CHECK: = ElemGet [[a]],
// CHECK: = RequireObjectCoercible [[a]] nullishAccess=Update
// CHECK: = ElemGet [[a]],
// CHECK: = RequireObjectCoercible [[a]] nullishAccess=Update
// CHECK-NEXT: = PropGet [[a]] key="NaN"

export function compound(a, k) {
  a[k] += 1;
}

export function knownToTheBuildAlone(a) {
  a.b;
  const k = "p";
  a[k] ??= 1;
}

export function logical(a) {
  a[undefined] ??= 1;
}

export function numberOrText(a) {
  a["p"]++;
  a[2] += 1;
  a[1 + 2] ??= 1;
}

export function printedAsWritten(a) {
  const k = "p";
  a[k]++;
  a[`p${1}`] ??= 1;
  a[`p${`q${"r"}`}`] += 1;
}

export function symbol(a) {
  a[Symbol.iterator]++;
}

export function update(a) {
  a[true]++;
  --a[null];
  a[NaN]--;
}
