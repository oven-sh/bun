// RUN(THIS): link
// OPTIONS: type-errors=log
// THIS: typesite [[site]] module=[[entry]] {{*}}kind=This text="Box"
// THIS: layout [[box]] name="Box" module=[[entry]]
// THIS: module [[entry]] path="{{*}}declared-positions"
// THIS: function [[f]] name="f" module=[[entry]] {{*}}flags=[HasThis, {{*}}thisType={type=undefined|null|[[box]] site=[[site]] flags=[OmitsNull, OmitsUndefined]}

// RUN(PARAMETER): link
// PARAMETER: typesite [[site]] module=[[entry]] {{*}}kind=Parameter text="number"
// PARAMETER: module [[entry]] path="{{*}}declared-positions"
// PARAMETER: function [[f]] name="f" module=[[entry]] {{*}}parameters=[{type=number site=[[site]]}]

// RUN(RESULT): link
// RESULT: typesite [[site]] module=[[entry]] {{*}}kind=Result text="string"
// RESULT: module [[entry]] path="{{*}}declared-positions"
// RESULT: function [[f]] name="f" module=[[entry]] {{*}}results=[{type=undefined|null|string site=[[site]] flags=[OmitsNull, OmitsUndefined]}]

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
