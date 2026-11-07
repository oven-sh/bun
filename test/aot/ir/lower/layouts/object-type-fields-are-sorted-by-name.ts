// RUN: link
// CHECK: layout [[i]] name="I" {{*}}fields=[{key="a" declared={type={{*}}}}, {key="b" declared={type={{*}}} flags=[IsRequired]}, {key="m" declared={type={{*}}} flags=[IsRequired, IsMethod]}]

// RUN(SITES): link
// SITES-NOT: layout {{*}}name="I"{{*}}site=

// RUN(LITERAL): link
// LITERAL: layout [[i]] name="I"
// LITERAL: function {{*}}name="create"
// LITERAL: = NewObject {{*}}layout=[[i]] fields=[1, 0, 2]

// Fields are sorted by name, so every type with these names numbers them the same way. A literal lists the field indexes in the order it fills them.
interface I {
  b: number;
  a?: string;
  m(): void;
}

export function use(value: I) {
  return value;
}

export function create(): I {
  return { b: 1, a: "a", m() {} };
}
