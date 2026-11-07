// RUN: link
// CHECK: expectedresult [[expected]] type=L{{*}} layouts=[L
// CHECK-NOT: site=
// CHECK: layout L
// CHECK: function {{*}}name="typed"
// CHECK: = Call {{*}}expectedResult=[[expected]]
// CHECK: Return

// RUN(TAGGED): link
// TAGGED: expectedresult [[expected]] type=Array<undefined|null|L{{*}}> layouts=[L
// TAGGED-NOT: site=
// TAGGED: layout L
// TAGGED: function {{*}}name="tagged"
// TAGGED: = Call {{*}}expectedResult=[[expected]]
// TAGGED: Return

// RUN(DECLARED): lower
// DECLARED-LABEL: function {{*}}name="declared"
// DECLARED-NOT: expectedResult=
// DECLARED: Return

// RUN(COMPILED): lower
// COMPILED-LABEL: function {{*}}name="compiled"
// COMPILED-NOT: expectedResult=
// COMPILED: Return

// RUN(INFERRED): lower
// INFERRED-LABEL: function {{*}}name="inferred"
// INFERRED-NOT: expectedResult=
// INFERRED: Return

interface Row {
  id: number;
}

declare function query<T>(text: string): T;
declare function plain(text: string): Row;
declare function tag<T>(strings: TemplateStringsArray, ...values: unknown[]): T;

function made<T>(value: T): T[] {
  return [value];
}

export function compiled() {
  return made<Row>({ id: 1 });
}

export function declared() {
  return plain("b");
}

export function inferred(): Row {
  return query("c");
}

export function tagged() {
  return tag<Row[]>`select`;
}

export function typed() {
  return query<Row>("a");
}
