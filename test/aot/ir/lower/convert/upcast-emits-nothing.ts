// RUN: link
// CHECK: layout {{*}}name="Person"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[named]]]
// CHECK: function {{*}}name="byAssertion" module=
// CHECK: = Convert {{*}}declared={type=undefined|null|[[named]] site=[[assertion]] flags=[OmitsNull, OmitsUndefined]} @
// CHECK: function {{*}}name="byDeclaration" module=
// CHECK: = Convert {{*}}declared={type=undefined|null|[[named]] site=[[variable]] flags=[OmitsNull, OmitsUndefined]} @

// RUN(CAUSES): lower
// CAUSES-LABEL: function {{*}}name="byAssertion"
// CAUSES-NOT: illTypedCause=
// CAUSES-LABEL: function {{*}}name="byDeclaration"
// CAUSES-NOT: illTypedCause=
// CAUSES-LABEL: function {{*}}name="down"
// CAUSES: = Convert {{*}}declared={type=undefined|null|L{{*}}} illTypedCause=Assertion

// An upcast emits nothing to test. The conversion puts the source below the target, so the family of the target covers it. Every conversion is sent, this one without a cause, and the engine drops it because the family of the source is inside the target's. The way down has its cause, and the engine tests it.
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
