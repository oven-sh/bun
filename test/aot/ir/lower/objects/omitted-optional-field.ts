// RUN(LAST): lower
// LAST-LABEL: function {{*}}name="withoutLast"
// LAST: = NewObject -, [[a]] layout={{*}}fields=[0]

// RUN(FIRST): lower
// FIRST-LABEL: function {{*}}name="withoutFirst"
// FIRST: = NewObject -, [[b]] layout={{*}}fields=[1]

// RUN(BOTH): lower
// BOTH-LABEL: function {{*}}name="withBoth"
// BOTH: = NewObject -, [[a]], [[b]] layout={{*}}fields=[0, 1]

interface Options {
  a?: number;
  b?: string;
}

export function withoutLast(a: number) {
  const o: Options = { a };
  return o;
}

export function withoutFirst(b: string) {
  const o: Options = { b };
  return o;
}

export function withBoth(a: number, b: string) {
  const o: Options = { a, b };
  return o;
}
