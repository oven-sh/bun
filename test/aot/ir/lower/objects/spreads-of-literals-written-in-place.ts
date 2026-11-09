// A literal that is written in the place of a spread is never made: its members are members of the object that the spread stands in.
// What is defined on one way only is defined behind FinishObject: every definition in front of it is carried out.

// RUN(AND): lower
// AND-LABEL: function {{*}}name="and"
// AND: [[head]] = NewObject -, {{*}} layout={{*}}fields=[
// AND-NEXT: [[finished]] = FinishObject [[head]]
// AND-NOT: NewObject
// AND-NOT: CopyDataProperties
// AND: PropDefine [[finished]], {{*}}key="c"
// AND: PropDefine [[finished]], {{*}}key="d"
// AND-NOT: FinishObject
// AND: Return {{*}} @

// RUN(EITHER): lower
// EITHER-LABEL: function {{*}}name="either"
// EITHER-NOT: CopyDataProperties
// EITHER: PropDefine {{*}}key="yes"
// EITHER: PropDefine {{*}}key="no"

// RUN(PLAIN): lower
// PLAIN-LABEL: function {{*}}name="plain"
// PLAIN: [[head]] = NewObject -, {{*}}, {{*}}, {{*}} layout={{*}}fields=[
// PLAIN-NEXT: = FinishObject [[head]]
// PLAIN-NOT: CopyDataProperties

// RUN(OTHER): lower
// OTHER-LABEL: function {{*}}name="otherArm"
// OTHER: PropDefine {{*}}key="y"
// OTHER: CopyDataProperties {{*}}, {{*}} @

// What has a getter, a method, a computed key or a prototype of its own is a literal like any other, and so is what no literal ends.
// RUN(KEPT): lower
// KEPT-LABEL: function {{*}}name="kept"
// KEPT-COUNT-5: CopyDataProperties

export function and(a: number, extra: boolean): { a: number; c?: number; d: number } {
  return { a, ...(extra && { c: a }), d: 4 };
}

export function either(flag: boolean, i: number) {
  return { first: 1, ...(flag ? { yes: i } : { no: i }) };
}

export function plain(i: number) {
  return { a: i, ...{ b: i, c: i } };
}

export function otherArm(flag: boolean, other: object) {
  return { x: 1, ...(flag ? { y: 2 } : other) };
}

export function kept(on: boolean, key: string, base: object, other: object) {
  return {
    ...(on && { get g() { return 1; } }),
    ...(on && { m() { return 1; } }),
    ...(on && { [key]: 1 }),
    ...(on && { __proto__: base }),
    ...(on && other),
  };
}
