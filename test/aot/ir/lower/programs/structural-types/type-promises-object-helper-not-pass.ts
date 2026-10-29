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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v3 = Data data=[[d_3]]
// CHECK-NEXT: v4 = PropGet v0 key="data"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_4]] site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v6 = PropGet v0 key="methods"
// CHECK-NEXT: v7 = Call v2, v1, v3, v5, v6 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="dataBelow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_7]] site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v5 = PropGet v0 key="data"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_9]] site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = Call v4, v3, v6 calleeName="Object.create"
// CHECK-NEXT: v8 = PropGet v0 key="methods"
// CHECK-NEXT: v9 = Call v2, v1, v7, v8 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|[[L_7]] site=[[w_8]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_11]]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_13]]} illTypedCause=Assertion
// CHECK-NEXT: v2 = PropGet v1 key="count"
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_14]]}
// CHECK-NEXT: PropSet v1, v4 key="count"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_15]]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_13]]} illTypedCause=Assertion
// CHECK-NEXT: v2 = PropGet v1 key="read"
// CHECK-NEXT: v3 = Call v2, v1 calleeKey="read" calleeName="this.read"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_17]]}
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Mul v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_18]]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_13]]} illTypedCause=Assertion
// CHECK-NEXT: v2 = PropGet v1 key="count"
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_20]]}
// CHECK-NEXT: PropSet v1, v4 key="count"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_21]]}] functionTypes={{*}}[[f_22]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_13]]} illTypedCause=Assertion
// CHECK-NEXT: v2 = PropGet v1 key="read"
// CHECK-NEXT: v3 = Call v2, v1 calleeKey="read" calleeName="this.read"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_23]]}
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Mul v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_21]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_24]]}] functionTypes={{*}}[[f_25]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_26]]} illTypedCause=Assertion
// CHECK-NEXT: v2 = PropGet v1 key="count"
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_27]]}
// CHECK-NEXT: PropSet v1, v4 key="count"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
