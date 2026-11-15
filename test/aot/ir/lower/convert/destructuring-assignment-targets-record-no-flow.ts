// RUN(MEMBER): link
// MEMBER: layout {{*}}module={{*}}fields=[{key="member"
// MEMBER-NOT: supertypes=
// MEMBER: layout

// RUN(FIELD): link
// FIELD: layout {{*}}module={{*}}fields=[{key="field"
// FIELD-NOT: supertypes=
// FIELD: layout

// RUN(DEFAULT): link
// DEFAULT: layout {{*}}module={{*}}fields=[{key="byDefault"
// DEFAULT-NOT: supertypes=
// DEFAULT: layout

// RUN(BRANCH): link
// BRANCH: layout {{*}}module={{*}}fields=[{key="branch"
// BRANCH-NOT: supertypes=
// BRANCH: layout

// RUN(ELEMENT): link
// ELEMENT: layout {{*}}module={{*}}fields=[{key="element"
// ELEMENT-NOT: supertypes=
// ELEMENT: layout

// RUN(TUPLE): link
// TUPLE: layout {{*}}module={{*}}fields=[{key="tuple"
// TUPLE-NOT: supertypes=
// TUPLE: layout

// RUN(NESTED): link
// NESTED: layout {{*}}module={{*}}fields=[{key="nested"
// NESTED-NOT: supertypes=
// NESTED: layout

// RUN(RESTELEMENT): link
// RESTELEMENT: layout {{*}}module={{*}}fields=[{key="restElement"
// RESTELEMENT-NOT: supertypes=
// RESTELEMENT: layout

// RUN(RESTMEMBER): link
// RESTMEMBER: layout {{*}}module={{*}}fields=[{key="restMember"
// RESTMEMBER-NOT: supertypes=
// RESTMEMBER: layout

// RUN(LOOP): link
// LOOP: layout {{*}}module={{*}}fields=[{key="loop"
// LOOP-NOT: supertypes=
// LOOP: layout

// RUN(SKIPPED): link
// SKIPPED-NOT: layout {{*}}fields=[{key="restElementName"{{*}}{key="restMemberName"{{*}}supertypes=

// RUN(CONVERT): lower
// CONVERT-LABEL: function {{*}}name="field"
// CONVERT: [[fieldRead]] = PropGet {{*}}key="x"
// CONVERT-NEXT: PropSet {{*}}, [[fieldRead]] key="f"
// CONVERT-LABEL: function {{*}}name="member"
// CONVERT: [[memberRead]] = PropGet {{*}}key="x"
// CONVERT: [[memberStored]] = Convert [[memberRead]] declared={type=undefined|null|L
// CONVERT: Return [[memberStored]]
// CONVERT-LABEL: function {{*}}name="restMember"
// CONVERT: [[copy]] = NewObject layout=[[restLayout]]
// CONVERT: CopyDataProperties [[copy]], {{*}}excludedKeys=["a"]
// CONVERT: = Convert {{*}}declared={type=undefined|null|[[restLayout]]

// A destructuring assignment converts what the pattern takes out to the type of each target that is a variable with an annotation. A member as a target gets no `Convert`: the layout says what the field holds. A pattern declares nothing, so what it takes out goes below the type of no target: not a member, an element, a default or a branch of one, the elements or the members of a rest. The copy that a rest makes of an object is allocated with the layout of the target's type.
interface MemberTarget {
  memberName: string;
}

interface MemberSource {
  memberName: string;
  member: number;
}

interface FieldTarget {
  fieldName: string;
}

interface FieldSource {
  fieldName: string;
  field: number;
}

interface DefaultTarget {
  defaultName: string;
}

interface DefaultSource {
  defaultName: string;
  byDefault: number;
}

interface BranchTarget {
  branchName: string;
}

interface BranchSource {
  branchName: string;
  branch: number;
}

interface ElementTarget {
  elementName: string;
}

interface ElementSource {
  elementName: string;
  element: number;
}

interface TupleTarget {
  tupleName: string;
}

interface TupleSource {
  tupleName: string;
  tuple: number;
}

interface NestedTarget {
  nestedName: string;
}

interface NestedSource {
  nestedName: string;
  nested: number;
}

interface RestElementTarget {
  restElementName: string;
}

interface RestElementSource {
  restElementName: string;
  restElement: number;
}

interface RestMemberTarget {
  restMemberName: string;
}

interface RestMemberSource {
  restMemberName: string;
  restMember: number;
}

interface LoopTarget {
  loopName: string;
}

interface LoopSource {
  loopName: string;
  loop: number;
}

interface Skipped {
  tupleName: string;
  restElementName: string;
  restMemberName: string;
  skipped: number;
}

export function member(source: MemberSource, from: { x: MemberSource }) {
  let target: MemberTarget | undefined;
  ({ x: target } = from);
  return target;
}

export function field(source: FieldSource, from: { x: FieldSource }, holder: { f: FieldTarget }) {
  ({ x: holder.f } = from);
  return holder;
}

export function byDefault(source: DefaultSource, from: { x?: DefaultTarget }) {
  let target: DefaultTarget | undefined;
  ({ x: target = source } = from);
  return target;
}

export function branchOfDefault(source: BranchSource, other: BranchTarget, from: { x?: BranchTarget }, first: boolean) {
  let target: BranchTarget | undefined;
  ({ x: target = first ? source : other } = from);
  return target;
}

export function element(source: ElementSource, from: ElementSource[]) {
  let target: ElementTarget | undefined;
  [target] = from;
  return target;
}

export function tuple(source: TupleSource, from: [Skipped, TupleSource]) {
  let target: TupleTarget | undefined;
  [, target] = from;
  return target;
}

export function nested(source: NestedSource, from: { a: { b: NestedSource }[] }) {
  let target: NestedTarget | undefined;
  ({
    a: [{ b: target }],
  } = from);
  return target;
}

export function restElement(source: RestElementSource, from: [Skipped, RestElementSource, RestElementSource]) {
  let first: unknown;
  let rest: RestElementTarget[] = [];
  [first, ...rest] = from;
  return rest;
}

export function restMember(source: RestMemberSource, from: { a: Skipped; b: RestMemberSource }) {
  let a: unknown;
  let rest: { b: RestMemberTarget } | undefined;
  ({ a, ...rest } = from);
  return rest;
}

export function loop(source: LoopSource, from: { x: LoopSource[] }[]) {
  let target: LoopTarget | undefined;
  for ({
    x: [target],
  } of from) {
  }
  return target;
}
