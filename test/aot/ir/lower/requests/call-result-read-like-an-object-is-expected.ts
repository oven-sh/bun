// The engine sees what a function of the program returns where it knows who is called and what that returns. Of any other call it has nothing to go by, and the checker has a type.
// So the result of a call goes with the checker's type as a guess, which the engine tests where it goes by it, where both hold: the result is read like an object (it initializes a variable,
// or a member or an element is read off it, also behind `!`), and the type names a layout.
// RUN: lower
// CHECK-LABEL: function {{*}}name="discarded"
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="handedOn"
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="inVariable"
// CHECK: [[made]] = Call {{*}}calleeName="create"
// CHECK-NEXT: [[entry]] = Convert [[made]] declared={type=undefined|null|[[layout]] flags=[IsExpected]}
// CHECK-NEXT: PropSet [[entry]], {{*}}key="parent"
// CHECK-LABEL: function {{*}}name="memberRead"
// CHECK: [[other]] = Call {{*}}calleeName="create"
// CHECK-NEXT: [[read]] = Convert [[other]] declared={type=undefined|null|[[layout]] flags=[IsExpected]}
// CHECK-NEXT: = PropGet [[read]] key="name"
// CHECK-LABEL: function {{*}}name="noObject"
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="notNull"
// CHECK: [[found]] = Call {{*}}calleeName="find"
// CHECK-NEXT: [[present]] = Convert [[found]] declared={type=undefined|null|[[layout]] flags=[IsExpected]}
// CHECK-NEXT: = PropGet [[present]] key="name"
// CHECK-LABEL: function {{*}}name="returned"
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="create"

interface Entry {
  name: string;
  parent?: Entry;
}

function create(name: string) {
  const made: Entry = { name };
  return made;
}

function find(list: Entry[], name: string) {
  return list.find(entry => entry.name === name);
}

function count(list: Entry[]) {
  return list.length;
}

function take(entry: Entry) {
  return entry;
}

export function inVariable(parent: Entry) {
  const entry = create("a");
  entry.parent = parent;
  return entry;
}

export function memberRead() {
  return create("a").name;
}

export function notNull(list: Entry[]) {
  return find(list, "a")!.name;
}

export function noObject(list: Entry[]) {
  const size = count(list);
  return size;
}

export function discarded() {
  create("a");
}

export function handedOn() {
  return take(create("a"));
}

export function returned() {
  return create("a");
}
