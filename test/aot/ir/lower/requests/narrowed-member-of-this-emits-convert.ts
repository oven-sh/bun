// RUN: link
// CHECK: layout [[word]] name="Word"
// CHECK: function {{*}}name="textBehindGuard" module=
// CHECK: [[argument]] = PropGet [[guardedThis]] key="current"
// CHECK-NOT: = Convert [[argument]]
// CHECK: Branch
// CHECK: [[guardedRead]] = PropGet [[guardedThis]] key="current"
// CHECK-NEXT: [[guarded]] = Convert [[guardedRead]] declared={type=undefined|null|[[word]]} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[guarded]] key="text"
// CHECK: function {{*}}name="textOfCurrent" module=
// CHECK: [[wide]] = PropGet [[this]] key="current"
// CHECK-NEXT: = PropGet [[wide]] key="kind"
// CHECK: Branch
// CHECK: [[read]] = PropGet [[this]] key="current"
// CHECK-NEXT: [[current]] = Convert [[read]] declared={type=undefined|null|[[word]]} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[current]] key="text"

// `this.current` is a reference like `cursor.current`: behind a test of it, a read whose type is narrower than the type of the field is converted to that type, and the member is read from the converted value. `this` has the type of its position, so both reads take it as it is, and so does the read in front of the test.
interface Word {
  kind: 1;
  text: string;
}

interface Mark {
  kind: 2;
}

function isWord(token: Word | Mark): token is Word {
  return token.kind === 1;
}

export class Cursor {
  current: Word | Mark;

  constructor(current: Word | Mark) {
    this.current = current;
  }

  textBehindGuard() {
    return isWord(this.current) ? this.current.text : "";
  }

  textOfCurrent() {
    return this.current.kind === 1 ? this.current.text : "";
  }
}
