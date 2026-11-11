// RUN: lower
// CHECK-LABEL: function {{*}}name="written"
// CHECK: ([[box]]: {{*}}, [[stored]]: anything):
// CHECK-NOT: Convert
// CHECK: PropSet [[box]], [[stored]] key="value"

// RUN(ANNOTATED): lower
// ANNOTATED-LABEL: function {{*}}name="annotated"
// ANNOTATED: ([[stored]]: anything):
// ANNOTATED-NOT: Return
// ANNOTATED: PropSet {{*}}, [[stored]] key="value"

// RUN(ARGUMENT): lower
// ARGUMENT-LABEL: function {{*}}name="writtenArgument"
// ARGUMENT: ([[stored]]: anything):
// ARGUMENT-NOT: Return
// ARGUMENT: PropSet {{*}}, [[stored]] key="value"

// RUN(INFERRED): lower
// INFERRED-LABEL: function {{*}}name="inferred"
// INFERRED: ([[stored]]: anything):
// INFERRED-NOT: Return
// INFERRED: PropSet {{*}}, [[stored]] key="value"

// RUN(DIRECT): lower
// DIRECT-LABEL: function {{*}}name="inferredAtTheCall"
// DIRECT: ([[stored]]: anything):
// DIRECT-NOT: Return
// DIRECT: PropSet {{*}}, [[stored]] key="value"

// What is stored into a member is converted to nothing, whether somebody wrote the type argument of `Box<number>` (in the type of a parameter, in the annotation of a variable, at the call) or the checker inferred it: the layout says what the field is declared to hold, and the slot judges what arrives.
interface Box<T> {
  value: T;
}

declare function make<T>(x: T): Box<T>;

export function inferred(v: any) {
  const c = make(1);
  c.value = v;
}

export function inferredAtTheCall(v: any) {
  make(1).value = v;
}

export function annotated(v: any) {
  const c: Box<number> = make(1);
  c.value = v;
}

export function writtenArgument(v: any) {
  make<number>(1).value = v;
}

export function written(b: Box<number>, v: any) {
  b.value = v;
}
