// RUN(REDUCED): link
// REDUCED: layout {{*}}name="ReducedSource"{{*}}supertypes=[{{*}}[[target]]]
// REDUCED: layout [[target]] name="ReducedTarget"

// RUN(CONTEXT): link
// CONTEXT: layout {{*}}name="ContextSource"{{*}}supertypes=[{{*}}[[target]]]
// CONTEXT: layout [[target]] name="ContextTarget"

// RUN(BRANCH): link
// BRANCH: layout {{*}}name="BranchSource"{{*}}supertypes=[{{*}}[[target]]]
// BRANCH: layout [[target]] name="BranchTarget"

// RUN(SPREAD): link
// SPREAD: layout {{*}}name="SpreadSource"{{*}}supertypes=[{{*}}[[target]]]
// SPREAD: layout [[target]] name="SpreadTarget"

// RUN(NESTED): link
// NESTED: layout {{*}}name="NestedSource"{{*}}supertypes=[{{*}}[[target]]]
// NESTED: layout [[target]] name="NestedTarget"

// RUN(ENTRY): link
// ENTRY: layout {{*}}name="EntrySource"{{*}}supertypes=[{{*}}[[target]]]
// ENTRY: layout [[target]] name="EntryTarget"

// RUN(TUPLE): link
// TUPLE: layout {{*}}name="TupleSource"{{*}}supertypes=[{{*}}[[target]]]
// TUPLE: layout [[target]] name="TupleTarget"

// RUN(OTHER): link
// OTHER-NOT: layout {{*}}name="OtherPlace"{{*}}supertypes=

// RUN(BACK): link
// BACK-NOT: layout {{*}}name="ReducedTarget"{{*}}supertypes=

// The checker reduces the union of the element types, so beside a `ReducedTarget` a `ReducedSource` leaves no trace in the type of the literal, and no conversion of the whole literal can put it below the target. Each element flows for itself into what the list holds at its place: the element type of the literal and of the type it is written under, the place of a tuple, the contents of a spread. Nothing flows the other way or into another place of a tuple.
interface ReducedTarget {
  reducedName: string;
}

interface ReducedSource {
  reducedName: string;
  reduced: number;
}

interface ContextTarget {
  contextName: string;
}

interface ContextSource {
  contextName: string;
  context: number;
}

interface BranchTarget {
  branchName: string;
}

interface BranchSource {
  branchName: string;
  branch: number;
}

interface SpreadTarget {
  spreadName: string;
}

interface SpreadSource {
  spreadName: string;
  spread: number;
}

interface NestedTarget {
  nestedName: string;
}

interface NestedSource {
  nestedName: string;
  nested: number;
}

interface EntryTarget {
  entryName: string;
}

interface EntrySource {
  entryName: string;
  entry: number;
}

interface TupleTarget {
  tupleName: string;
}

interface TupleSource {
  tupleName: string;
  tuple: number;
}

interface OtherPlace {
  tupleName: string;
  otherPlace: number;
}

export function reduced(source: ReducedSource, target: ReducedTarget) {
  return [source, target];
}

export function underContext(source: ContextSource, target: ContextTarget) {
  const all: ContextTarget[] = [target, source];
  return all;
}

export function branch(source: BranchSource, target: BranchTarget, first: boolean) {
  return [first ? source : target];
}

export function spread(source: SpreadSource, sources: SpreadSource[], target: SpreadTarget) {
  return [target, ...sources];
}

export function nested(source: NestedSource, target: NestedTarget) {
  return { lists: [[target], [source]] };
}

export function entries(source: EntrySource, target: EntryTarget) {
  return new Map([
    ["a", target],
    ["b", source],
  ]);
}

export function tuple(source: TupleSource, other: OtherPlace) {
  const pair: [OtherPlace, TupleTarget] = [other, source];
  return pair;
}
