// RUN: link
// CHECK: layout {{*}}name="Person"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[named]]]
// CHECK: function {{*}}name="byAssertion" module=
// CHECK: = Convert {{*}}declared={type=undefined|null|[[named]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion @
// CHECK: function {{*}}name="byDeclaration" module=
// CHECK: = Convert {{*}}declared={type=undefined|null|[[named]] flags=[OmitsNull, OmitsUndefined]} @

// RUN(CAUSES): lower
// CAUSES-LABEL: function {{*}}name="byAssertion"
// CAUSES: = Convert {{*}}declared={type=undefined|null|L{{*}}} illTypedCause=Assertion
// CAUSES-LABEL: function {{*}}name="byDeclaration"
// CAUSES-NOT: illTypedCause=
// CAUSES-LABEL: function {{*}}name="down"
// CAUSES: = Convert {{*}}declared={type=undefined|null|L{{*}}} illTypedCause=Assertion

// An upcast emits nothing to test. The cast puts the type of its operand below the type that is written, so the family of the target covers it. Every conversion is sent, and the engine drops this one because the family of the source is inside the target's. The cause claims nothing and goes by what is written: a cast has the cause of an assertion, up as down, and a declaration has none.
interface Named {
  name: string;
}

export class Person {
  name = "a";
  age = 1;
}

export function byAssertion(person: Person) {
  return person as Named;
}

export function byDeclaration(person: Person) {
  const named: Named = person;
  return named;
}

export function down(named: Named) {
  return named as Person;
}
