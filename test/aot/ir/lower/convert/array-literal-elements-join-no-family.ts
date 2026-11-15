// RUN: link
// CHECK-NOT: layout {{*}}name="ReducedSource"{{*}}supertypes=
// CHECK-NOT: layout {{*}}name="ReducedTarget"{{*}}supertypes=
// CHECK-NOT: layout {{*}}name="ContextSource"{{*}}supertypes=
// CHECK-NOT: layout {{*}}name="BranchSource"{{*}}supertypes=
// CHECK-NOT: layout {{*}}name="SpreadSource"{{*}}supertypes=
// CHECK-NOT: layout {{*}}name="NestedSource"{{*}}supertypes=
// CHECK-NOT: layout {{*}}name="EntrySource"{{*}}supertypes=
// CHECK-NOT: layout {{*}}name="TupleSource"{{*}}supertypes=
// CHECK-NOT: layout {{*}}name="OtherPlace"{{*}}supertypes=
// CHECK-NOT: layout {{*}}name="FirstPlace"{{*}}supertypes=
// CHECK-NOT: layout {{*}}name="SecondPlace"{{*}}supertypes=

// RUN(CAST): link
// CAST: layout [[target]] {{*}}name="CastTarget"
// CAST: layout {{*}}name="CastSource"{{*}}supertypes=[{{*}}[[target]]]

// A family holds what is declared. An element joins none by standing in a list: not that of the elements beside it, of the type that the list is written under, of the place of a tuple or of the contents of a spread. An element that is cast to a type is below that type.
class ReducedTarget {
  reducedName = "";
}

class ReducedSource {
  reducedName = "";
  reduced = 0;
}

class ContextTarget {
  contextName = "";
}

class ContextSource {
  contextName = "";
  context = 0;
}

class BranchTarget {
  branchName = "";
}

class BranchSource {
  branchName = "";
  branch = 0;
}

class SpreadTarget {
  spreadName = "";
}

class SpreadSource {
  spreadName = "";
  spread = 0;
}

class NestedTarget {
  nestedName = "";
}

class NestedSource {
  nestedName = "";
  nested = 0;
}

class EntryTarget {
  entryName = "";
}

class EntrySource {
  entryName = "";
  entry = 0;
}

class TupleTarget {
  tupleName = "";
}

class TupleSource {
  tupleName = "";
  tuple = 0;
}

class OtherPlace {
  tupleName = "";
  otherPlace = 0;
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

class FirstPlace {
  first = 0;
}

class SecondPlace {
  second = 0;
}

export function copyOfTuple(pair: [FirstPlace, SecondPlace]) {
  const copied: [FirstPlace, SecondPlace] = [...pair];
  return copied;
}

class CastTarget {
  castName = "";
}

class CastSource {
  castName = "";
  cast = 0;
}

export function castElement(source: CastSource, target: CastTarget) {
  return [target, source as CastTarget];
}
