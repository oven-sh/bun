// RUN(SIZED): link
// SIZED: expectedresult {{*}}validation=[{shape=Union{arms=[1, 2]} {{*}}}, {shape=Object{layout=L{{*}} members=[{key="a" node=3 field=0}]} {{*}}text="Sized"}, {shape=Dictionary{value=3}

// RUN(TABLE): link
// TABLE: expectedresult {{*}}validation=[{shape=Union{arms=[1, 2]} {{*}}}, {shape=Dictionary{value=3} {{*}}}, {shape=Object{layout=L{{*}} members=[{key="a" node=3 field=0}]} {{*}}text="Sized"}

// RUN(PRIMITIVES): link
// PRIMITIVES: expectedresult {{*}}validation=[{shape=Union{arms=[1, 2, 3]} {{*}}}, {shape=Null {{*}}}, {shape=StringLiteral{value="a"} {{*}}}, {shape=StringLiteral{value="b"}

/// <reference path="./imports/declarations.d.ts" />

type Sized = { a: number };

export function sizedFirst(text: string) {
  return JSON.parse<Sized | Record<string, number>>(text);
}

export function tableFirst(text: string) {
  return JSON.parse<Record<string, number> | Sized>(text);
}

export function primitives(text: string) {
  return JSON.parse<"b" | null | "a">(text);
}
