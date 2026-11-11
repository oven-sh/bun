// RUN: lower
// CHECK-LABEL: function {{*}}name="textBehindGuard"
// CHECK: [[argument]] = PropGet [[guardedThis]] key="current"
// CHECK-NEXT: = Call {{*}}, -, [[argument]] calleeName="isWord"
// CHECK: Branch
// CHECK: [[guarded]] = PropGet [[guardedThis]] key="current"
// CHECK-NEXT: = PropGet [[guarded]] key="text"
// CHECK-LABEL: function {{*}}name="textOfCurrent"
// CHECK: [[wide]] = PropGet [[this]] key="current"
// CHECK-NEXT: = PropGet [[wide]] key="kind"
// CHECK: Branch
// CHECK: [[current]] = PropGet [[this]] key="current"
// CHECK-NEXT: = PropGet [[current]] key="text"

// RUN(CONVERTS): lower
// CONVERTS-LABEL: function {{*}}name="textBehindGuard"
// CONVERTS-NOT: Convert
// CONVERTS-LABEL: function {{*}}name="textOfCurrent"
// CONVERTS-NOT: Convert

// `this.current` is a reference like `cursor.current`: the checker narrows it behind a test of it, and nothing of that is sent. The read behind the test is used as it is, like the read in front of the test, and the member is read from it. `this` has the type of its position, so both reads take it as it is.
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

// A method has its body once reached code reads its name.
export function readsTheNames(o: any) { return [o.isWord, o.textBehindGuard, o.textOfCurrent]; }
