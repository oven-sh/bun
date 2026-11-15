// RUN(TWIG): link
// TWIG: layout {{*}}name="Twig" {{*}}supertypes=[
// TWIG-NOT: ,
// TWIG: [[twig]]] flags=[IsConstructorFunction]
// TWIG: layout [[twig]] module={{*}}fields=[{key="length"

// RUN(BUD): link
// BUD: layout {{*}}name="Bud" {{*}}supertypes=[
// BUD-NOT: ,
// BUD: [[bud]]] flags=[IsConstructorFunction]
// BUD: layout [[bud]] module={{*}}fields=[{key="color"

// RUN(THORN): link
// THORN: layout {{*}}name="Thorn" {{*}}supertypes=[
// THORN-NOT: ,
// THORN: [[thorn]]] flags=[IsConstructorFunction]
// THORN: layout [[thorn]] module={{*}}fields=[{key="point"

// RUN(APART): link
// APART-NOT: layout [[record]] module=[[entry]] {{*}}supertypes=
// APART: layout {{*}}name="Twig" module=[[entry]]
// APART-NOT: layout [[record]] module=[[entry]] {{*}}supertypes=

// Each interface is made by the one function that declares it as its `this`. A variable that holds any of the three is cast to the one that the code knows it to be:
// that says nothing of the other two, so no interface goes below another, and what is typed `Twig` is what `Twig` makes.
interface Twig {
  length: number;
}

interface Bud {
  color: string;
}

interface Thorn {
  point: boolean;
}

function Twig(this: Twig, length: number) {
  this.length = length;
}

function Bud(this: Bud, color: string) {
  this.color = color;
}

function Thorn(this: Thorn, point: boolean) {
  this.point = point;
}

type Growth = Twig | Bud | Thorn;

export function lengthOf(growth: Growth): number {
  return (growth as Twig).length;
}

export function colorOf(growth: Growth): string {
  return (growth as Bud).color;
}

export function pointOf(growth: Growth): boolean {
  return (growth as Thorn).point;
}

export const grown: Growth[] = [new (Twig as any)(1), new (Bud as any)("red"), new (Thorn as any)(true)];
