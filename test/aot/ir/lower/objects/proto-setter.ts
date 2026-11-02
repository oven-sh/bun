// RUN(NAMED): lower
// NAMED-LABEL: function {{*}}name="named"
// NAMED: [[head]] = NewObject layout=[[layout]] @
// NAMED-NEXT: SetLiteralPrototype [[head]],
// NAMED-NOT: key="__proto__"
// NAMED: Return

// RUN(QUOTED): lower
// QUOTED-LABEL: function {{*}}name="quoted"
// QUOTED: [[head]] = NewObject layout=[[layout]] @
// QUOTED-NEXT: SetLiteralPrototype [[head]],
// QUOTED-NOT: key="__proto__"
// QUOTED: Return

// RUN(SHORTHAND): lower
// SHORTHAND-LABEL: function {{*}}name="shorthand"
// SHORTHAND-NOT: SetLiteralPrototype
// SHORTHAND: PropDefine {{*}}key="__proto__"
// SHORTHAND-NOT: SetLiteralPrototype
// SHORTHAND: Return

// RUN(COMPUTED): lower
// COMPUTED-LABEL: function {{*}}name="computed"
// COMPUTED-NOT: SetLiteralPrototype
// COMPUTED: PropDefine {{*}}key="__proto__"
// COMPUTED-NOT: SetLiteralPrototype
// COMPUTED: Return

// RUN(AFTER): lower
// AFTER-LABEL: function {{*}}name="afterField"
// AFTER: [[head]] = NewObject -, [[a]] layout={{*}}fields=[0]
// AFTER-NEXT: SetLiteralPrototype [[head]],
// AFTER-NEXT: = FinishObject [[head]]

// RUN(BEFORE): lower
// BEFORE-LABEL: function {{*}}name="beforeFields"
// BEFORE: [[head]] = NewObject -, [[a]], [[b]] layout={{*}}fields=[0, 1]
// BEFORE-NEXT: SetLiteralPrototype [[head]],
// BEFORE-NEXT: = FinishObject [[head]]

// RUN(ORDER): lower
// ORDER-LABEL: function {{*}}name="valuesInSourceOrder"
// ORDER: [[called]] = Call {{*}}calleeName="first"
// ORDER-NEXT: [[prototype]] = Convert [[called]] declared={type=undefined|null|object site=w{{*}}} @
// ORDER-NEXT: = Call {{*}}calleeName="second"
// ORDER: [[head]] = NewObject -, {{*}}fields=[0]
// ORDER-NEXT: SetLiteralPrototype [[head]], [[prototype]]
// ORDER-NEXT: = FinishObject [[head]]

// RUN(OPEN): lower
// OPEN-LABEL: function {{*}}name="afterComputedKey"
// OPEN: [[head]] = NewObject layout=
// OPEN-NOT: SetLiteralPrototype
// OPEN: ElemDefine [[head]],
// OPEN-NEXT: SetLiteralPrototype [[head]],
// OPEN: = FinishObject [[head]]

export function named(p: object | null) {
  return { __proto__: p };
}

export function quoted(p: object | null) {
  return { "__proto__": p };
}

export function shorthand(__proto__: object | null) {
  return { __proto__ };
}

export function computed(p: object | null) {
  return { ["__proto__"]: p };
}

export function afterField(p: object | null) {
  return { a: 1, __proto__: p };
}

export function beforeFields(p: object | null, n: number) {
  return { __proto__: p, a: n, b: 2 };
}

export function valuesInSourceOrder(first: () => object | null, second: () => number) {
  return { __proto__: first(), a: second() };
}

export function afterComputedKey(p: object | null, k: string) {
  return { [k]: 1, __proto__: p };
}
