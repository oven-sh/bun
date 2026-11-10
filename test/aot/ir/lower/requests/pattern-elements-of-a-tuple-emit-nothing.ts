// RUN: link
// CHECK: layout [[item]] {{*}}fields=[{key="name"
// CHECK: function {{*}}name="declared" module={{*}}parameters=[{type=undefined|null|Array<undefined|null|string|[[item]]> flags=[OmitsNull, OmitsUndefined]}]
// CHECK: b0([[pair]]:
// CHECK: [[steps]] = IteratorOpen [[pair]] elementCount=2 [isDestructuring]
// CHECK: [[firstStep]] = IteratorResume [[steps]] stepIndex=0
// CHECK: [[label]] = ResultAt [[firstStep]] index=1
// CHECK-NOT: Convert
// CHECK: [[secondStep]] = IteratorResume [[steps]] stepIndex=1
// CHECK: [[held]] = ResultAt [[secondStep]] index=1
// CHECK-NOT: Convert
// CHECK: [[name]] = PropGet [[held]] key="name"
// CHECK-NEXT: = Add [[label]], [[name]]
// CHECK: function {{*}}name="inLoop" module=
// CHECK: [[loopSteps]] = IteratorOpen {{*}}elementCount=2 [isDestructuring]
// CHECK: [[loopFirstStep]] = IteratorResume [[loopSteps]] stepIndex=0
// CHECK: [[loopKey]] = ResultAt [[loopFirstStep]] index=1
// CHECK-NOT: Convert
// CHECK: [[loopSecondStep]] = IteratorResume [[loopSteps]] stepIndex=1
// CHECK: [[loopHeld]] = ResultAt [[loopSecondStep]] index=1
// CHECK-NOT: Convert
// CHECK: [[loopName]] = PropGet [[loopHeld]] key="name"
// CHECK-NEXT: = Add [[loopKey]], [[loopName]]
// CHECK: function {{*}}name="ofParameter" module=
// CHECK: b0([[parameter]]:
// CHECK: [[parameterSteps]] = IteratorOpen [[parameter]] elementCount=2 [isDestructuring]
// CHECK: [[parameterFirstStep]] = IteratorResume [[parameterSteps]] stepIndex=0
// CHECK: [[parameterLabel]] = ResultAt [[parameterFirstStep]] index=1
// CHECK-NOT: Convert
// CHECK: [[parameterSecondStep]] = IteratorResume [[parameterSteps]] stepIndex=1
// CHECK: [[parameterHeld]] = ResultAt [[parameterSecondStep]] index=1
// CHECK-NOT: Convert
// CHECK: [[parameterName]] = PropGet [[parameterHeld]] key="name"
// CHECK-NEXT: = Add [[parameterLabel]], [[parameterName]]

// RUN(ANYTHING): lower
// ANYTHING-LABEL: function {{*}}name="ofAnything"
// ANYTHING: [[raw]] = ResultAt {{*}}index=1
// ANYTHING-NOT: = Convert
// ANYTHING: Return [[raw]]

// A tuple is sent as an array of the union of its elements. What an array pattern takes out is converted to nothing: the name holds what the step of the iterator gives, whatever the checker knows about it, and the engine follows what is stored. That holds in a declaration, in the head of a loop and in a parameter. The value the whole pattern takes apart has the type of its position and is not converted.
interface Item {
  name: string;
}

export function declared(pair: [string, Item]) {
  const [label, item] = pair;
  return label + item.name;
}

export function inLoop(entries: [string, Item][]) {
  let text = "";
  for (const [key, item] of entries) text += key + item.name;
  return text;
}

export function ofAnything(values: any) {
  const [first] = values;
  return first;
}

export function ofParameter([label, item]: [string, Item]) {
  return label + item.name;
}
