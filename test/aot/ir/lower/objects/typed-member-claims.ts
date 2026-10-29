// RUN(TYPED): lower
// TYPED-LABEL: function {{*}}name="typed"
// TYPED-NEXT: ([[v]]: anything):
// TYPED: [[converted]] = Convert [[v]] declared={type=number} illTypedCause=FromLooseType
// TYPED-NEXT: = NewObject -, [[converted]] layout={{*}}fields=[0]

// RUN(INFERRED): lower
// INFERRED-LABEL: function {{*}}name="inferred"
// INFERRED-NEXT: ([[v]]: anything):
// INFERRED-NOT: Convert
// INFERRED: = NewObject -, [[v]] layout={{*}}fields=[0]

export function typed(v: any) {
  const o: { a: number } = { a: v };
  return o;
}

export function inferred(v: any) {
  return { b: v };
}
