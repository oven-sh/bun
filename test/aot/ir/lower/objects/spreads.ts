// RUN(ONLY): lower
// ONLY-LABEL: function {{*}}name="copy"
// ONLY-NOT: NewObject
// ONLY: [[copy]] = CopyObject [[source]] @
// ONLY-NEXT: Return [[copy]]

// RUN(MIDDLE): lower
// MIDDLE-LABEL: function {{*}}name="extend"
// MIDDLE: [[head]] = NewObject -, [[x]] layout={{*}}fields=[
// MIDDLE-NEXT: CopyDataProperties [[head]], [[source]] @
// MIDDLE: PropDefine [[head]], {{*}}key="y"
// MIDDLE-NEXT: = FinishObject [[head]]

export function copy(a: object) {
  return { ...a };
}

export function extend(a: object) {
  return { x: 1, ...a, y: 2 };
}
