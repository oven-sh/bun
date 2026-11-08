// RUN: lower
// CHECK-LABEL: function {{*}}name="throughField"
// CHECK: [[picked]] = Call {{*}}calleeName="source.pick"
// CHECK-NEXT: Return [[picked]]
// CHECK-LABEL: function {{*}}name="throughMethod"
// CHECK: [[row]] = Call {{*}}calleeName="source.read"
// CHECK-NEXT: [[expectedRow]] = Convert [[row]] declared={type=undefined|null|[[layout]] flags=[IsExpected]}
// CHECK-NEXT: Return [[expectedRow]]
// CHECK-LABEL: function {{*}}name="throughParameter"
// CHECK: [[made]] = Call {{*}}calleeName="make"
// CHECK-NEXT: [[expectedMade]] = Convert [[made]] declared={type=undefined|null|[[layout]] flags=[IsExpected]}
// CHECK-NEXT: Return [[expectedMade]]

// RUN(CAPTURE): lower
// CAPTURE-LABEL: function {{*}}kind=Arrow
// CAPTURE: [[captured]] = Call {{*}}calleeName="inner"
// CAPTURE-NEXT: Return [[captured]]

// RUN(UNWRITTEN): lower
// UNWRITTEN-LABEL: function {{*}}name="unwrittenResult"
// UNWRITTEN: = Call {{*}}calleeName="guess"
// UNWRITTEN-NOT: Convert
// UNWRITTEN: Return

// The result of a call through a value of a function type is claimed to be nothing, whatever holds the callee: a field, a method of an interface, a parameter, a capture. A signature in a type stands for functions of the program, and the engine sees what those return where it knows who is called. Here it does not, so a result that a variable takes goes with the layout that the signature names, as a guess. A number is no object, and `any` names nothing.
interface Row {
  id: number;
}

interface Source {
  read(): Row;
  pick: (key: string) => number;
}

export function throughCapture(inner: () => number) {
  return () => {
    var value = inner();
    return value;
  };
}

export function throughField(source: Source) {
  var value = source.pick("a");
  return value;
}

export function throughMethod(source: Source) {
  var value = source.read();
  return value;
}

export function throughParameter(make: () => Row) {
  var value = make();
  return value;
}

export function unwrittenResult(guess: () => any) {
  var value = guess();
  return value;
}
