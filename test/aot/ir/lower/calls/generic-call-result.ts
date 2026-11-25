// RUN(ELEMENTS): lower
// ELEMENTS-LABEL: function {{*}}name="elements"
// ELEMENTS: parameters=[{type=undefined|null|Array<undefined|null|[[foo]]> flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Array<undefined|null|[[bar]]> flags=[OmitsNull, OmitsUndefined]}]
// ELEMENTS-NOT: Convert
// ELEMENTS: [[written]] = Call {{*}}calleeName="first"
// ELEMENTS-NEXT: [[expectedFoo]] = Convert [[written]] declared={type=undefined|null|[[foo]] flags=[IsExpected]}
// ELEMENTS: [[inferred]] = Call {{*}}calleeName="first"
// ELEMENTS-NEXT: [[expectedBar]] = Convert [[inferred]] declared={type=undefined|null|[[bar]] flags=[IsExpected]}
// ELEMENTS-NEXT: = PropGet [[expectedFoo]] key="foo"
// ELEMENTS-NEXT: = PropGet [[expectedBar]] key="bar"

// RUN(CONTAINERS): lower
// CONTAINERS-LABEL: function {{*}}name="containers"
// CONTAINERS: parameters=[{type=undefined|null|[[foo]] flags=[OmitsNull, OmitsUndefined]},
// CONTAINERS-NOT: Convert
// CONTAINERS: [[list]] = Call {{*}}calleeName="wrap"
// CONTAINERS-NOT: Convert
// CONTAINERS: [[promise]] = Call {{*}}calleeName="later"
// CONTAINERS-NOT: Convert
// CONTAINERS: [[map]] = Call {{*}}calleeName="index"
// CONTAINERS-NEXT: = NewArray [[list]], [[promise]], [[map]]

// RUN(METHODS): lower
// METHODS-LABEL: function {{*}}name="methods"
// METHODS-NOT: Convert
// METHODS: [[got]] = Call {{*}}calleeName="box.get"
// METHODS-NEXT: [[foo]] = Convert [[got]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// METHODS-NEXT: [[made]] = Call {{*}}calleeName="make"
// METHODS-NEXT: [[box]] = Convert [[made]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// METHODS: [[other]] = Call {{*}}, [[box]] calleeKey="get"
// METHODS-NEXT: [[bar]] = Convert [[other]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// METHODS-NOT: Convert
// METHODS: [[text]] = Call {{*}}calleeName="box.map"
// METHODS-NEXT: [[number]] = PropGet [[foo]] key="foo"
// METHODS-NEXT: [[name]] = PropGet [[bar]] key="bar"
// METHODS-NEXT: = NewArray [[number]], [[name]], [[text]]

// RUN(DEFAULTS): lower
// DEFAULTS-LABEL: function {{*}}name="defaults"
// DEFAULTS: [[made]] = Call {{*}}calleeName="make"
// DEFAULTS-NEXT: [[foo]] = Convert [[made]] declared={type=undefined|null|L{{*}}} illTypedCause=FromLooseType
// DEFAULTS-NEXT: = PropGet [[foo]] key="foo"

// RUN(VALUE): lower
// VALUE-LABEL: function {{*}}name="throughValue"
// VALUE: {type=undefined|null|Array<undefined|null|[[foo]]> flags=[OmitsNull, OmitsUndefined]}]
// VALUE: [[answer]] = Call {{*}}calleeName="chosen"
// VALUE-NEXT: [[expected]] = Convert [[answer]] declared={type=undefined|null|[[foo]] flags=[IsExpected]}
// VALUE-NEXT: = PropGet [[expected]] key="foo"

// RUN(AWAITED): lower
// AWAITED-LABEL: function {{*}}name="awaited"
// AWAITED: parameters=[{type=undefined|null|[[foo]] flags=[OmitsNull, OmitsUndefined]}]
// AWAITED: [[promise]] = Call {{*}}calleeName="later"
// AWAITED-NEXT: [[got]] = Await [[promise]],
// AWAITED-NEXT: = PropGet [[got]] key="foo"

// RUN(INSIDE): lower
// INSIDE-LABEL: function {{*}}name="first"
// INSIDE: parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}]
// INSIDE-NOT: Convert
// INSIDE: Return [[element]]

// Inside `first` the `T` says nothing, and one body serves every call. The engine sees what a function of the program returns, so the result of a call of one is claimed to be nothing. Where the result is read like an object and the checker's type of the call names a layout, that type goes along as a guess, whatever put it in the place of `T`: a type argument that is written, one that the checker infers, one that the type of the receiver brings. An array, a promise or a map names no layout, and a string is no object. What an `await` takes out is not converted. `make` is not in the program, so its result is converted to the type that the checker has for the call, here the default. That is a written type like any other: it claims nothing, the engine tests the value once where it arrives, and a value that fails the test leaves the typed code.
interface Foo {
  foo: number;
}

interface Bar {
  bar: string;
}

class Box<T> {
  constructor(private held: T) {}

  get(): T {
    return this.held;
  }

  map<U>(change: (held: T) => U): U {
    return change(this.held);
  }
}

declare function make<T = Foo>(): T;

function first<T>(list: T[]): T {
  return list[0];
}

function last<T>(list: T[]): T {
  return list[list.length - 1];
}

function wrap<T>(value: T): T[] {
  return [value];
}

async function later<T>(value: T): Promise<T> {
  return value;
}

function index<K, V>(key: K, value: V): Map<K, V> {
  return new Map([[key, value]]);
}

export function elements(foos: Foo[], bars: Bar[]) {
  const foo = first<Foo>(foos);
  const bar = first(bars);
  return [foo.foo, bar.bar];
}

export function containers(foo: Foo, name: string) {
  const list = wrap(foo);
  const promise = later(foo);
  const map = index(name, foo);
  return [list, promise, map];
}

export function methods(box: Box<Foo>, make: () => Box<Bar>) {
  const foo = box.get();
  const bar = make().get();
  const text = box.map(held => String(held.foo));
  return [foo.foo, bar.bar, text];
}

export function defaults() {
  return make().foo;
}

export function throughValue(pick: boolean, foos: Foo[]) {
  const chosen = pick ? first : last;
  return chosen(foos).foo;
}

export async function awaited(foo: Foo) {
  const got = await later(foo);
  return got.foo;
}
