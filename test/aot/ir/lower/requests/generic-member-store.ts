// RUN: lower
// CHECK-LABEL: function {{*}}name="written"
// CHECK: [[converted]] = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet {{*}}, [[converted]] key="value"

// RUN(ANNOTATED): lower
// ANNOTATED-LABEL: function {{*}}name="annotated"
// ANNOTATED: ([[stored]]: anything):
// ANNOTATED: [[number]] = Convert [[stored]] declared={type=number {{*}}}
// ANNOTATED-NEXT: PropSet {{*}}, [[number]] key="value"

// RUN(ARGUMENT): lower
// ARGUMENT-LABEL: function {{*}}name="writtenArgument"
// ARGUMENT: ([[stored]]: anything):
// ARGUMENT: [[number]] = Convert [[stored]] declared={type=number {{*}}}
// ARGUMENT-NEXT: PropSet {{*}}, [[number]] key="value"

// RUN(INFERRED): lower
// INFERRED-LABEL: function {{*}}name="inferred"
// INFERRED: ([[stored]]: anything):
// INFERRED: [[same]] = Convert [[stored]] declared={type=undefined|null|L{{*}}}
// INFERRED-NEXT: PropSet {{*}}, [[same]] key="value"

// RUN(DIRECT): lower
// DIRECT-LABEL: function {{*}}name="inferredAtTheCall"
// DIRECT: ([[stored]]: anything):
// DIRECT: [[same]] = Convert [[stored]] declared={type=undefined|null|L{{*}}}
// DIRECT-NEXT: PropSet {{*}}, [[same]] key="value"

// Each instantiation of a generic interface is a layout of its own, whose field has the type argument. What is stored through `Box<number>` is converted to `number` where somebody wrote that type argument: in the type of a parameter, in the annotation of a variable, at the call. A type argument that the checker inferred decides nothing: the store is converted to what the interface says of the member, the type parameter, which is a layout of its own that nobody allocates (../types/type-parameter-is-a-layout.ts), never to `number`.
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
