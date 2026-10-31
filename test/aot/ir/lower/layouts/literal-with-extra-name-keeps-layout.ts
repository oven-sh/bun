// RUN(SPREAD): link
// SPREAD: layout [[i]] name="I" {{*}}fields=[{key="a"
// SPREAD: function {{*}}name="spread"
// SPREAD-NOT: Return
// SPREAD: [[head]] = NewObject {{*}}layout=[[i]] fields=[0]
// SPREAD-NEXT: CopyDataProperties [[head]],

// RUN(COMPUTED): link
// COMPUTED: layout [[i]] name="I" {{*}}fields=[{key="a"
// COMPUTED: function {{*}}name="computed"
// COMPUTED-NOT: Return
// COMPUTED: [[head]] = NewObject {{*}}layout=[[i]] fields=[0]
// COMPUTED-NEXT: ElemDefine [[head]],

// RUN(FIELDS): link
// FIELDS-NOT: layout {{*}}name="I"{{*}}}, {key=

interface I {
  a: number;
}

declare function f(i: I): void;

export function spread(a: number, rest: { b: number }) {
  f({ a, ...rest });
}

export function computed(a: number, k: string) {
  f({ a, [k]: 2 });
}
