// RUN: link
// CHECK: layout [[item]] name="Item"
// CHECK: function {{*}}name="declared" module=
// CHECK: b0([[pair]]:
// CHECK: [[steps]] = IteratorOpen [[pair]] elementCount=2 [isDestructuring]
// CHECK: [[firstStep]] = IteratorResume [[steps]] stepIndex=0
// CHECK: [[first]] = ResultAt [[firstStep]] index=1
// CHECK-NEXT: [[label]] = Convert [[first]] declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK: [[secondStep]] = IteratorResume [[steps]] stepIndex=1
// CHECK: [[second]] = ResultAt [[secondStep]] index=1
// CHECK-NEXT: [[held]] = Convert [[second]] declared={type=undefined|null|[[item]]} illTypedCause=Assertion
// CHECK: [[name]] = PropGet [[held]] key="name"
// CHECK-NEXT: = Add [[label]], [[name]]
// CHECK: function {{*}}name="inLoop" module=
// CHECK: [[loopSteps]] = IteratorOpen {{*}}elementCount=2 [isDestructuring]
// CHECK: [[loopFirstStep]] = IteratorResume [[loopSteps]] stepIndex=0
// CHECK: [[loopFirst]] = ResultAt [[loopFirstStep]] index=1
// CHECK-NEXT: = Convert [[loopFirst]] declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK: [[loopSecondStep]] = IteratorResume [[loopSteps]] stepIndex=1
// CHECK: [[loopSecond]] = ResultAt [[loopSecondStep]] index=1
// CHECK-NEXT: [[loopHeld]] = Convert [[loopSecond]] declared={type=undefined|null|[[item]]} illTypedCause=Assertion
// CHECK: = PropGet [[loopHeld]] key="name"
// CHECK: function {{*}}name="ofParameter" module=
// CHECK: b0([[parameter]]:
// CHECK: [[parameterSteps]] = IteratorOpen [[parameter]] elementCount=2 [isDestructuring]
// CHECK: [[parameterFirstStep]] = IteratorResume [[parameterSteps]] stepIndex=0
// CHECK: [[parameterFirst]] = ResultAt [[parameterFirstStep]] index=1
// CHECK-NEXT: = Convert [[parameterFirst]] declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK: [[parameterSecondStep]] = IteratorResume [[parameterSteps]] stepIndex=1
// CHECK: [[parameterSecond]] = ResultAt [[parameterSecondStep]] index=1
// CHECK-NEXT: [[parameterHeld]] = Convert [[parameterSecond]] declared={type=undefined|null|[[item]]} illTypedCause=Assertion
// CHECK: = PropGet [[parameterHeld]] key="name"

// RUN(ANYTHING): lower
// ANYTHING-LABEL: function {{*}}name="ofAnything"
// ANYTHING: [[raw]] = ResultAt {{*}}index=1
// ANYTHING-NOT: = Convert
// ANYTHING: Return [[raw]]

// A tuple is sent as an array of the union of its elements, so a step of the iterator says less than the checker knows about the name it is bound to. What an array pattern takes out is converted to the checker's type of the node that receives it, each element to its own type, and the name holds the converted value: nothing converts it again. That holds in a declaration, in the head of a loop and in a parameter. The value the whole pattern takes apart has the type of its position and is not converted. An element that the checker knows nothing about is bound as it is.
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
