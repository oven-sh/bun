// `{ ...source, name }` where no type says which names the source has, whatever the type of the literal says about the names that are written: the object is born as a copy of what it spreads.
// Made with a layout of the written names it would keep the copied ones beside its fields.

// RUN(VARIABLE): lower
// VARIABLE-LABEL: function {{*}}name="ofTypeVariable"
// VARIABLE-NOT: NewObject
// VARIABLE: [[copy]] = CopyObject {{*}} @
// VARIABLE: PropDefine [[copy]], {{*}}key="name"
// VARIABLE-NOT: FinishObject
// VARIABLE: Return

// RUN(OBJECT): lower
// OBJECT-LABEL: function {{*}}name="ofObject"
// OBJECT-NOT: NewObject
// OBJECT: [[copy]] = CopyObject {{*}} @
// OBJECT: PropDefine [[copy]], {{*}}key="name"
// OBJECT: Return

// RUN(ANY): lower
// ANY-LABEL: function {{*}}name="ofAny"
// ANY-NOT: NewObject
// ANY: [[copy]] = CopyObject {{*}} @
// ANY: CopyDataProperties [[copy]], {{*}} @
// ANY: Return

// A source whose names its type knows: the literal has the layout of its own type.
// RUN(KNOWN): lower
// KNOWN-LABEL: function {{*}}name="ofKnownNames"
// KNOWN-NOT: CopyObject
// KNOWN: [[head]] = NewObject
// KNOWN: CopyDataProperties [[head]], {{*}} @
// KNOWN: Return

export function ofTypeVariable<T extends object>(source: T, name: string): T & { name: string } {
  return { ...source, name };
}

export function ofObject(source: object, name: string) {
  return { ...source, name };
}

export function ofAny(source: any, other: { a: number }) {
  return { ...source, ...other };
}

export function ofKnownNames(source: { a: number }, name: string) {
  return { ...source, name };
}
