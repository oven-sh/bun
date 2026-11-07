// RUN(TAG): link
// TAG: layout {{*}}name="TagSource"
// TAG-NOT: supertypes=
// TAG: layout

// RUN(SUPER): link
// SUPER: layout {{*}}name="SuperSource"
// SUPER-NOT: supertypes=
// SUPER: layout

// RUN(TUPLE): link
// TUPLE: layout {{*}}name="TupleSource"
// TUPLE-NOT: supertypes=
// TUPLE: layout

// RUN(REST): link
// REST: layout {{*}}name="RestSource"
// REST-NOT: supertypes=
// REST: layout

// RUN(UNUSED): link
// UNUSED-NOT: layout {{*}}name="Unused"{{*}}supertypes=

// RUN(DECLARED): link
// DECLARED: layout [[base]] {{*}}name="Base"
// DECLARED: layout {{*}}name="Derived"{{*}}supertypes=[{{*}}[[base]]]

// Passing an argument declares nothing, so it puts no layout below the type of the parameter, in any form of a call: a substitution of a tagged template, a tuple that is spread, also in `super(...)`, a place of a rest parameter whose type is a tuple. The callee tests its parameter, and an object that only fits the type fails the test. What `extends` declares is listed.
class TagTarget {
  tagName = "";
}

class TagSource {
  tagName = "";
  tag = 0;
}

class SuperTarget {
  superName = "";
}

class SuperSource {
  superName = "";
  superCall = 0;
}

class TupleTarget {
  tupleName = "";
}

class TupleSource {
  tupleName = "";
  tuple = 0;
}

class RestTarget {
  restName = "";
}

class RestSource {
  restName = "";
  rest = 0;
}

class Unused {
  tagName = "";
  unused = 0;
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
