// Nothing is written of a member of a class, so what an update reads goes into the operator as it is.

// RUN(FIELD): lower
// FIELD-LABEL: function {{*}}name="bump"
// FIELD: [[read]] = PropGet {{*}}key="count"
// FIELD-NEXT: = Increment [[read]]

// RUN(PRIVATE): lower
// PRIVATE-LABEL: function {{*}}name="lower"
// PRIVATE: [[read]] = PrivateGet
// PRIVATE-NEXT: = Decrement [[read]]

// RUN(STATIC): lower
// STATIC-LABEL: function {{*}}name="note"
// STATIC: [[read]] = PropGet {{*}}key="made"
// STATIC-NEXT: = Increment [[read]]

// RUN(UNSEEN): lower
// UNSEEN-LABEL: function {{*}}name="noteUnseen"
// UNSEEN-NOT: Convert
// UNSEEN: [[test]] = TypeTest {{*}}testedType=absent
// UNSEEN-NEXT: Branch [[test]] -> taken {{*}}(| 0), notTaken [[present]](| 0)
// UNSEEN: [[present]]([[read]]):
// UNSEEN-NEXT: = Increment [[read]]

// RUN(SUPER): lower
// SUPER-LABEL: function {{*}}name="raise"
// SUPER: [[read]] = SuperGet {{*}}key="level"
// SUPER-NOT: Convert
// SUPER: = Add [[read]],

class Base {
  get level() {
    return 1;
  }
  set level(to) {}
}

export class Counter extends Base {
  static made = 0;
  static #unseen = 0;
  #steps = 0;
  count = 0;

  bump() {
    this.count++;
  }

  lower() {
    --this.#steps;
  }

  static note() {
    Counter.made++;
  }

  static noteUnseen() {
    Counter.#unseen++;
  }

  raise() {
    super.level += 1;
  }
}

// A method has its body once reached code reads its name.
export function readsTheNames(o) { return [o.bump, o.noteUnseen, o.raise]; }
