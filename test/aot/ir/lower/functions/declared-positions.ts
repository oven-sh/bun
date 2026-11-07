// RUN(THIS): link
// THIS: layout [[box]] module=[[entry]] {{*}}fields=[{key="value"
// THIS: module [[entry]] path="{{*}}declared-positions.ts"
// THIS: function [[f]] name="f" module=[[entry]] {{*}}flags=[HasThis, {{*}}thisType={type=undefined|null|[[box]] flags=[OmitsNull, OmitsUndefined]}

// RUN(PARAMETER): link
// PARAMETER: module [[entry]] path="{{*}}declared-positions.ts"
// PARAMETER: function [[f]] name="f" module=[[entry]] {{*}}parameters=[{type=number}]

// RUN(RESULT): link
// RESULT: module [[entry]] path="{{*}}declared-positions.ts"
// RESULT: function [[f]] name="f" module=[[entry]] {{*}}results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}]

// RUN(UNTYPED): lower
// UNTYPED: function {{*}}name="g"{{*}}thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}]

interface Box {
  value: number;
}

export function f(this: Box, a: number): string {
  return this.value + "" + a;
}

export function g(a: any): any {
  return a;
}
