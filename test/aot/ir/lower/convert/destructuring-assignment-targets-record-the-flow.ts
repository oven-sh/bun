// RUN(MEMBER): link
// MEMBER: layout {{*}}name="MemberSource"{{*}}supertypes=[{{*}}[[target]]]
// MEMBER: layout [[target]] name="MemberTarget"

// RUN(FIELD): link
// FIELD: layout {{*}}name="FieldSource"{{*}}supertypes=[{{*}}[[target]]]
// FIELD: layout [[target]] name="FieldTarget"

// RUN(DEFAULT): link
// DEFAULT: layout {{*}}name="DefaultSource"{{*}}supertypes=[{{*}}[[target]]]
// DEFAULT: layout [[target]] name="DefaultTarget"

// RUN(BRANCH): link
// BRANCH: layout {{*}}name="BranchSource"{{*}}supertypes=[{{*}}[[target]]]
// BRANCH: layout [[target]] name="BranchTarget"

// RUN(ELEMENT): link
// ELEMENT: layout {{*}}name="ElementSource"{{*}}supertypes=[{{*}}[[target]]]
// ELEMENT: layout [[target]] name="ElementTarget"

// RUN(TUPLE): link
// TUPLE: layout {{*}}name="TupleSource"{{*}}supertypes=[{{*}}[[target]]]
// TUPLE: layout [[target]] name="TupleTarget"

// RUN(NESTED): link
// NESTED: layout {{*}}name="NestedSource"{{*}}supertypes=[{{*}}[[target]]]
// NESTED: layout [[target]] name="NestedTarget"

// RUN(RESTELEMENT): link
// RESTELEMENT: layout {{*}}name="RestElementSource"{{*}}supertypes=[{{*}}[[target]]]
// RESTELEMENT: layout [[target]] name="RestElementTarget"

// RUN(RESTMEMBER): link
// RESTMEMBER: layout {{*}}name="RestMemberSource"{{*}}supertypes=[{{*}}[[target]]]
// RESTMEMBER: layout [[target]] name="RestMemberTarget"

// RUN(LOOP): link
// LOOP: layout {{*}}name="LoopSource"{{*}}supertypes=[{{*}}[[target]]]
// LOOP: layout [[target]] name="LoopTarget"

// RUN(SKIPPED): link
// SKIPPED-NOT: layout {{*}}name="Skipped"{{*}}supertypes=

// RUN(CONVERT): lower
// CONVERT-LABEL: function {{*}}name="field"
// CONVERT: [[fieldRead]] = PropGet {{*}}key="x"
// CONVERT: [[fieldStored]] = Convert [[fieldRead]] declared={type=undefined|null|L{{*}} site=w
// CONVERT: PropSet {{*}}, [[fieldStored]] key="f"
// CONVERT-LABEL: function {{*}}name="member"
// CONVERT: [[memberRead]] = PropGet {{*}}key="x"
// CONVERT: [[memberStored]] = Convert [[memberRead]] declared={type=undefined|null|L{{*}} site=w
// CONVERT: Return [[memberStored]]
// CONVERT-LABEL: function {{*}}name="restMember"
// CONVERT: [[copy]] = NewObject layout=[[restLayout]]
// CONVERT: CopyDataProperties [[copy]], {{*}}excludedKeys=["a"]
// CONVERT: = Convert {{*}}declared={type=undefined|null|[[restLayout]] site=w

// A destructuring assignment converts what the pattern takes out to the type of each target. The member, the element or the default goes below the type of its target, each branch of a default for itself. A rest is a copy: its elements or members flow, and the copy of an object is allocated with the layout of the target's type. What the pattern skips or gives to an `unknown` goes nowhere.
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
