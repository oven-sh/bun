// RUN: lower
// OPTIONS: builtin-modules

// A this type promises an object that the helper does not pass.
function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

interface Description<D, M> {
  data: D;
  methods: M & ThisType<D & M>;
}

function joined<D extends object, M extends object>(description: Description<D, M>): D & M {
  return Object.assign({}, description.data, description.methods);
}
function onlyMethods<D extends object, M extends object>(description: Description<D, M>): M {
  return description.methods;
}
function dataBelow<D extends object, M extends object>(description: Description<D, M>): M {
  return Object.assign(Object.create(description.data), description.methods);
}

const honest = joined({
  data: { count: 1, label: "component" },
  methods: {
    read(): number {
      return this.count;
    },
    bump(): number {
      return ++this.count;
    },
    title(): string {
      return this.label.toUpperCase();
    },
    twice(): number {
      return this.read() * 2;
    },
  },
});
show("joined: read", () => honest.read());
show("joined: bump", () => honest.bump());
show("joined: title", () => honest.title());
show("joined: twice", () => honest.twice());
show("joined: keys", () => Object.keys(honest).join());

const bare = onlyMethods({
  data: { count: 1, label: "component" },
  methods: {
    read(): number {
      return this.count;
    },
    bump(): number {
      return ++this.count;
    },
    title(): string {
      return this.label.toUpperCase();
    },
    twice(): number {
      return this.read() * 2;
    },
  },
});
show("only the methods: read", () => bare.read());
show("only the methods: bump", () => bare.bump());
show("only the methods: title", () => bare.title());
show("only the methods: twice", () => bare.twice());
show("only the methods: keys", () => Object.keys(bare).join());

const source = { count: 1, label: "below" };
const below = dataBelow({
  data: source,
  methods: {
    read(): number {
      return this.count;
    },
    bump(): number {
      return ++this.count;
    },
    title(): string {
      return this.label.toUpperCase();
    },
  },
});
show("data on the prototype: read", () => below.read());
show("data on the prototype: bump", () => below.bump());
show("data on the prototype: title", () => below.title());
show("data on the prototype: keys", () => Object.keys(below).join());
show("data on the prototype: the source", () => source.count);

// GENERATED: joined dataBelow bump twice
// CHECK-LABEL: function {{*}}name="joined"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = PropGet v0 key="data"
// CHECK-NEXT: v4 = PropGet v0 key="methods"
// CHECK-NEXT: v5 = NewDictionary
// CHECK-NEXT: v6 = Builtin builtin=ObjectAssign [isNotReadFromHolder]
// CHECK-NEXT: v7 = Call v6, -, v5, v3, v4
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="dataBelow"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v5 = PropGet v0 key="data"
// CHECK-NEXT: v6 = Call v4, v3, v5 calleeName="Object.create"
// CHECK-NEXT: v7 = PropGet v0 key="methods"
// CHECK-NEXT: v8 = Call v2, v1, v6, v7 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="count"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: PropSet v0, v2 key="count"
// CHECK-NEXT: v4 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="read"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="read" calleeName="this.read"
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Mul v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="count"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: PropSet v0, v2 key="count"
// CHECK-NEXT: v4 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="read"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="read" calleeName="this.read"
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Mul v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="count"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: PropSet v0, v2 key="count"
// CHECK-NEXT: v4 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
