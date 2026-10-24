// RUN: lower
// CHECK-LABEL: function {{*}}name="throughField"
// CHECK: [[picked]] = Call {{*}}calleeName="source.pick"
// CHECK-NEXT: = Convert [[picked]] declared={type=number site=w{{*}}} @
// CHECK-LABEL: function {{*}}name="throughMethod"
// CHECK: [[row]] = Call {{*}}calleeName="source.read"
// CHECK-NEXT: = Convert [[row]] declared={type=undefined|null|L{{*}} site=w{{*}}} @
// CHECK-LABEL: function {{*}}name="throughParameter"
// CHECK: [[made]] = Call {{*}}calleeName="make"
// CHECK-NEXT: = Convert [[made]] declared={type=undefined|null|L{{*}} site=w{{*}}} @

// RUN(CAPTURE): lower
// CAPTURE-LABEL: function {{*}}kind=Arrow
// CAPTURE: [[captured]] = Call {{*}}calleeName="inner"
// CAPTURE-NEXT: = Convert [[captured]] declared={type=number site=w{{*}}} @

// RUN(UNWRITTEN): lower
// UNWRITTEN-LABEL: function {{*}}name="unwrittenResult"
// UNWRITTEN: = Call {{*}}calleeName="guess"
// UNWRITTEN-NOT: Convert
// UNWRITTEN: Return

// The result of a call is converted at the call, to the type that the checker gives the call, whatever the callee is. A signature in a type stands for the functions that were converted to it, so the conversion has no cause.
interface Row {
  id: number;
}

interface Source {
  read(): Row;
  pick: (key: string) => number;
}

export function throughCapture() {
  function inner(): number {
    return 1;
  }
  return () => {
    const value = inner();
    return value;
  };
}

export function throughField(source: Source) {
  const value = source.pick("a");
  return value;
}

export function throughMethod(source: Source) {
  const value = source.read();
  return value;
}

export function throughParameter(make: () => Row) {
  const value = make();
  return value;
}

export function unwrittenResult(guess: () => any) {
  const value = guess();
  return value;
}
