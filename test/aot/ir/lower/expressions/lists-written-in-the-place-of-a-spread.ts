// RUN(EITHER): lower
// EITHER-LABEL: function {{*}}name="either"
// EITHER: [[list]] = NewArray {{*}} contents=
// EITHER-NOT: NewArray
// EITHER-NOT: AppendSpread
// EITHER: Branch
// EITHER: AppendElement [[list]],
// EITHER: AppendElement [[list]],
// EITHER: Branch
// EITHER: AppendElement [[list]],
// EITHER: AppendElement [[list]],
// EITHER: AppendElement [[list]],
// EITHER: Return {{*}} @

// RUN(PLAIN): lower
// PLAIN-LABEL: function {{*}}name="plain"
// PLAIN: [[list]] = NewArray {{*}} contents=
// PLAIN-NOT: AppendSpread
// PLAIN-COUNT-3: AppendElement [[list]],
// PLAIN: Return {{*}} @

// RUN(OTHER): lower
// OTHER-LABEL: function {{*}}name="otherArm"
// OTHER: AppendElement
// OTHER: AppendSpread
// OTHER: Return {{*}} @

// RUN(KEPT): lower
// KEPT-LABEL: function {{*}}name="kept"
// KEPT-COUNT-3: AppendSpread

export function either(i: number, a: boolean, b: boolean): number[] {
  return [i, ...(a ? [i + 1] : []), 7, ...(b ? [i + 2, i + 3] : []), 9];
}
export function plain(i: number): number[] {
  return [0, ...[i, i + 1], 9];
}
export function otherArm(flag: boolean, other: Iterable<number>): number[] {
  return [1, ...(flag ? [2] : other), 3];
}
export function kept(on: boolean, list: number[], other: number[]): (number | undefined)[] {
  return [0, ...list, ...(on ? list : other), ...[, 1]];
}
