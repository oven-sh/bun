// RUN(READS): link
// OPTIONS: type-errors=log
// READS: typesite [[first]] module=[[entry]] {{*}}kind=Element
// READS: typesite [[second]] module=[[entry]] {{*}}kind=Element
// READS-NOT: typesite {{*}}module=[[entry]] {{*}}kind=Element
// READS: variable {{*}}name="a" module=[[entry]]

// RUN(VARIABLES): link
// VARIABLES: typesite [[first]] module=[[entry]] {{*}}kind=Variable text="string"
// VARIABLES: typesite [[second]] module=[[entry]] {{*}}kind=Variable text="string"
// VARIABLES-NOT: typesite {{*}}module=[[entry]] {{*}}kind=Variable
// VARIABLES: variable {{*}}name="a" module=[[entry]]

export function f(p: number[]) {
  return p[0] + p[0];
}

export let a: string = "", b: string = "";
