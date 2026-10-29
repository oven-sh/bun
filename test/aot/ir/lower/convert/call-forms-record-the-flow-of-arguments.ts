// RUN(TAG): link
// TAG: layout {{*}}name="TagSource"{{*}}supertypes=[{{*}}[[target]]]
// TAG: layout [[target]] name="TagTarget"

// RUN(SUPER): link
// SUPER: layout [[target]] name="SuperTarget"
// SUPER: layout {{*}}name="SuperSource"{{*}}supertypes=[{{*}}[[target]]]

// RUN(TUPLE): link
// TUPLE: layout {{*}}name="TupleSource"{{*}}supertypes=[{{*}}[[target]]]
// TUPLE: layout [[target]] name="TupleTarget"

// RUN(REST): link
// REST: layout {{*}}name="RestSource"{{*}}supertypes=[{{*}}[[target]]]
// REST: layout [[target]] name="RestTarget"

// RUN(UNUSED): link
// UNUSED-NOT: layout {{*}}name="Unused"{{*}}supertypes=

// An argument flows into its parameter in every form of a call. A substitution of a tagged template reaches the parameter behind the strings. The elements of a tuple that is spread flow like the elements of an array, also in `super(...)`. A rest parameter whose type is a tuple has a type for each place. A value that is passed to nothing goes nowhere.
interface TagTarget {
  tagName: string;
}

interface TagSource {
  tagName: string;
  tag: number;
}

interface SuperTarget {
  superName: string;
}

interface SuperSource {
  superName: string;
  superCall: number;
}

interface TupleTarget {
  tupleName: string;
}

interface TupleSource {
  tupleName: string;
  tuple: number;
}

interface RestTarget {
  restName: string;
}

interface RestSource {
  restName: string;
  rest: number;
}

interface Unused {
  tagName: string;
  unused: number;
}

function tag(strings: TemplateStringsArray, first: number, second: TagTarget) {
  return second;
}

export function tagged(source: TagSource, unused: Unused) {
  return tag`a${1}b${source}c`;
}

class Base {
  constructor(public held: SuperTarget) {}
}

export class Derived extends Base {
  constructor(...list: [SuperSource]) {
    super(...list);
  }
}

function takeTwo(first: number, second: TupleTarget) {
  return second;
}

export function spreadTuple(source: TupleSource, list: [number, TupleSource]) {
  return takeTwo(...list);
}

function takeRest(...rest: [number, RestTarget]) {
  return rest;
}

export function intoTupleRest(source: RestSource) {
  return takeRest(1, source);
}
