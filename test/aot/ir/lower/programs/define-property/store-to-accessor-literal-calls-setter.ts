// RUN: lower
// OPTIONS: builtin-modules

// A literal with `get` and `set` under one name, stored to again and again, while the program changes what lies under the name.
const lines: string[] = [];
const say = (...parts: unknown[]) => lines.push(parts.join(" "));
const attempt = (name: string, action: () => unknown) => {
  try {
    say(name, action());
  } catch (error) {
    say(name, (error as Error).constructor.name, (error as Error).message);
  }
};

function make(start: number) {
  return {
    held: start,
    calls: 0,
    get value(): number {
      return this.held;
    },
    set value(next: number) {
      this.calls++;
      this.held = next * 2;
    },
  };
}
type Made = ReturnType<typeof make>;

function store(object: Made, times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) {
    object.value = i & 7;
    sum += object.value;
  }
  return sum;
}

const plain = make(1);
say("as written", store(plain, 100), plain.calls, plain.held);
say("the value of the assignment", (plain.value = 21), plain.held);
plain.value += 1;
say("compound", plain.held);
plain.value++;
say("increment", plain.held, plain.calls);

// Another setter, the same getter.
const other = make(2);
Object.defineProperty(other, "value", {
  set(this: Made, next: number) {
    this.held = next + 1000;
  },
});
say("another setter", store(other, 100), other.calls, other.held);

// A setter that is no function of the program.
const bound = make(3);
const target = { seen: 0 };
Object.defineProperty(bound, "value", {
  set: function (this: typeof target, next: number) {
    this.seen += next;
  }.bind(target),
});
say("a bound setter", store(bound, 100), bound.calls, target.seen);

const native = make(4);
const list: number[] = [];
Object.defineProperty(native, "value", { set: Array.prototype.push.bind(list) });
say("a setter of the engine", store(native, 10), list.join());

const trapped = make(5);
const applied: string[] = [];
Object.defineProperty(trapped, "value", {
  set: new Proxy(function () {}, {
    apply(_target, receiver, args) {
      applied.push(`${receiver === trapped}:${args.length}:${args[0]}`);
    },
  }),
});
say("a proxy", store(trapped, 3), applied.join());

// No setter any more.
const without = make(6);
Object.defineProperty(without, "value", { set: undefined });
attempt("no setter", () => store(without, 100));
say("no setter left", without.calls, without.held, typeof Object.getOwnPropertyDescriptor(without, "value")!.get);

// No accessor any more.
const deleted = make(7);
delete (deleted as Partial<Made>).value;
say("deleted", store(deleted, 100), deleted.calls, deleted.held, JSON.stringify(Object.getOwnPropertyDescriptor(deleted, "value")));

const data = make(8);
Object.defineProperty(data, "value", { value: 5, writable: true });
say("a value", store(data, 100), data.calls, JSON.stringify(Object.getOwnPropertyDescriptor(data, "value")));

const fixed = make(9);
Object.defineProperty(fixed, "value", { value: 5, writable: false });
attempt("a value nobody writes", () => store(fixed, 100));

// Integrity levels leave an accessor what it is.
const frozen = Object.freeze(make(10));
attempt("frozen", () => store(frozen, 100));
say("frozen", frozen.calls, frozen.held);
const sealed = Object.seal(make(11));
say("sealed", store(sealed, 100), sealed.calls, sealed.held);

// The setter changes what lies under its own name.
const lazy = {
  computed: 0,
  get value(): number {
    return -1;
  },
  set value(next: number) {
    this.computed++;
    Object.defineProperty(this, "value", { value: next, writable: true, configurable: true, enumerable: true });
  },
};
let lazySum = 0;
for (let i = 0; i < 50; i++) {
  lazy.value = i;
  lazySum += lazy.value;
}
say("a setter that replaces itself", lazySum, lazy.computed);

// The setter throws.
const refusing = {
  accepted: 0,
  get value(): number {
    return this.accepted;
  },
  set value(next: number) {
    if (next > 3) throw new RangeError(`too much: ${next}`);
    this.accepted = next;
  },
};
attempt("a setter that throws", () => {
  for (let i = 0; i < 10; i++) refusing.value = i;
});
say("accepted", refusing.accepted);

// From below, the receiver is the heir.
const heir: Made = Object.create(make(12));
say("an heir", store(heir, 100), Object.keys(heir).join(), heir.calls, Object.getPrototypeOf(heir).calls);

// What the setter is given.
const counting = {
  given: "",
  get value(): number {
    return 0;
  },
  set value(next: number) {
    this.given = `${arguments.length}:${next}:${this === counting}`;
  },
};
counting.value = 4;
say("arguments", counting.given);

// Two literals of one shape with setters of their own.
function either(first: boolean) {
  return first
    ? {
        held: 0,
        get value(): number {
          return this.held;
        },
        set value(next: number) {
          this.held = next + 1;
        },
      }
    : {
        held: 0,
        get value(): number {
          return this.held;
        },
        set value(next: number) {
          this.held = next - 1;
        },
      };
}
let eitherSum = 0;
for (let i = 0; i < 100; i++) {
  const object = either((i & 1) === 0);
  object.value = i;
  eitherSum += object.value;
}
say("two literals", eitherSum);

// One of the shape has the getter alone.
function maybeSettable(settable: boolean): { held: number; value: number } {
  if (settable)
    return {
      held: 0,
      get value(): number {
        return this.held;
      },
      set value(next: number) {
        this.held = next;
      },
    };
  return {
    held: 7,
    get value(): number {
      return this.held;
    },
  } as { held: number; value: number };
}
function storeInto(object: { held: number; value: number }) {
  object.value = 3;
  return object.value;
}
for (let i = 0; i < 20; i++) storeInto(maybeSettable(true));
attempt("the getter alone", () => storeInto(maybeSettable(false)));

// Object.defineProperty with both halves.
const defined: { value: number; inner: number } = Object.defineProperty({ inner: 3 } as any, "value", {
  get(this: any) {
    return this.inner;
  },
  set(this: any, next: number) {
    this.inner = next * 3;
  },
});
let definedSum = 0;
for (let i = 0; i < 100; i++) {
  defined.value = i & 3;
  definedSum += defined.value;
}
say("defined", definedSum, Object.keys(defined).join(), JSON.stringify(Object.getOwnPropertyDescriptor(defined, "value")));

// An accessor that each instance gets in its constructor.
class Cell {
  inner = 0;
  declare value: number;
  constructor(step: number) {
    Object.defineProperty(this, "value", {
      get: () => this.inner,
      set: (next: number) => {
        this.inner = next + step;
      },
      enumerable: true,
      configurable: true,
    });
  }
}
const cells = [new Cell(1), new Cell(10)];
let cellSum = 0;
for (let i = 0; i < 100; i++) {
  const cell = cells[i & 1]!;
  cell.value = i;
  cellSum += cell.value;
}
say("in the constructor", cellSum);

// The store stands in front of the definition.
const late: { value?: number; held: number } = { held: 0 };
late.value = 1;
say("before", JSON.stringify(late));
Object.defineProperty(late, "value", {
  get(this: { held: number }) {
    return this.held;
  },
  set(this: { held: number }, next: number) {
    this.held = next + 5;
  },
  configurable: true,
  enumerable: true,
});
late.value = 1;
say("behind", JSON.stringify(late));

console.log(lines.join("\n"));

// GENERATED: make Cell say apply
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = NewObject -, v1, v3 layout=[[L_2]] fields=[1, 0]
// CHECK-NEXT: v5 = NewClosure function=[[f_4]]
// CHECK-NEXT: DefineGetter v4, v5 key="value"
// CHECK-NEXT: v7 = NewClosure function=[[f_5]]
// CHECK-NEXT: DefineSetter v4, v7 key="value"
// CHECK-NEXT: v9 = FinishObject v4
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Cell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_6]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_7]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_8]]
// CHECK-NEXT: v6 = Builtin builtin=Object
// CHECK-NEXT: v7 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v8 = String string="value"
// CHECK-NEXT: v9 = NewClosure v4 function=[[f_9]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v11 = NewObject layout=[[L_11]]
// CHECK-NEXT: PropDefine v11, v10 key="get"
// CHECK-NEXT: v13 = NewClosure v1, v4 function=[[f_12]]
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_13]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v11, v14 key="set"
// CHECK-NEXT: v16 = Boolean boolean=true
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|boolean}
// CHECK-NEXT: PropDefine v11, v17 key="enumerable"
// CHECK-NEXT: v19 = Boolean boolean=true
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|boolean}
// CHECK-NEXT: PropDefine v11, v20 key="configurable"
// CHECK-NEXT: v22 = FinishObject v11
// CHECK-NEXT: v23 = Call v7, v6, v4, v8, v22 calleeName="Object.defineProperty"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[L_7]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: v26 = TypeTest v25 testedType=object
// CHECK-NEXT: Branch v26 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v27):
// CHECK-NEXT: Jump -> next b4(v27)
// CHECK-NEXT: b3(v28):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v29):
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter, IsChecked] thisType={type=anything} parameters=[{type=Array site=[[w_15]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_16]]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="lines"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = PropGet v0 key="join"
// CHECK-NEXT: v5 = String string=" "
// CHECK-NEXT: v6 = Call v4, v0, v5 calleeKey="join" calleeName="parts.join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = Call v3, v2, v7 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=number site=[[w_20]]}}, {declared={type=number site=[[w_16]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="apply"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[f_21]] site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}, {type=undefined|null|Array site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_24]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_21]], v1: anything, v2: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_25]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="applied"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_26]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="trapped"
// CHECK-NEXT: v8 = StrictEq v1, v7
// CHECK-NEXT: v9 = ToString v8
// CHECK-NEXT: v10 = String string=":"
// CHECK-NEXT: v11 = PropGet v2 key="length"
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_27]]} illTypedCause=Assertion
// CHECK-NEXT: v13 = ToString v12
// CHECK-NEXT: v14 = String string=":"
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = ElemGet v2, v15
// CHECK-NEXT: v17 = ToString v16
// CHECK-NEXT: v18 = Strcat v9, v10, v13, v14, v17
// CHECK-NEXT: v19 = Call v5, v4, v18 calleeKey="push" calleeName="applied.push"
// CHECK-NEXT: v20 = Convert v19 declared={type=number site=[[w_28]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
