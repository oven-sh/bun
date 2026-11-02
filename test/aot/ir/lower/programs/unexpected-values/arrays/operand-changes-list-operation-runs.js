// RUN: lower
// OPTIONS: builtin-modules

// An operand changes the list before the operation runs.
function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

const log = [];

function noted(label, value) {
  log.push(label);
  return value;
}

const cases = {
  "the argument of push gives the list its own push"() {
    const list = [1];
    const answer = list.push((list.push = () => "its own push", 2));
    return [answer, list.length, list.push(3)];
  },
  "the argument of push changes the prototype"() {
    const list = [1];
    const answer = list.push(Object.setPrototypeOf(list, { push: () => "the other push" }) && 2);
    return [answer, list.length, list.push(3)];
  },
  "the argument of push replaces the variable"() {
    let list = [1];
    const first = list;
    const answer = list.push(((list = { push: () => "another object" }), 2));
    return [answer, first, list.push(3)];
  },
  "the argument of push freezes the list"() {
    const list = [1];
    return list.push(Object.freeze(list).length);
  },
  "the argument of push pushes"() {
    const list = [1];
    return [list.push(list.push(2)), list];
  },
  "the callback expression of map empties the list"() {
    const list = [1, 2, 3];
    return list.map(((list.length = 0), value => value * 2));
  },
  "the callback expression of map gives the list its own map"() {
    const list = [1, 2, 3];
    return list.map(((list.map = () => "its own map"), value => value * 2));
  },
  "the stored value shrinks the list"() {
    const list = [1, 2, 3];
    list[2] = ((list.length = 0), "stored");
    return list;
  },
  "the stored value replaces the variable"() {
    let list = [1, 2, 3];
    const first = list;
    list[0] = ((list = ["another"]), "stored");
    return [first, list];
  },
  "the stored value changes the index variable"() {
    const list = [1, 2, 3];
    let index = 0;
    list[index] = ((index = 2), "stored");
    return list;
  },
  "the stored value freezes the list"() {
    const list = [1, 2, 3];
    list[0] = (Object.freeze(list), "stored");
    return list;
  },
  "the index is incremented in the store"() {
    const list = [1, 2, 3];
    let index = 0;
    list[index++] = list[index];
    list[index] = index++;
    return [list, index];
  },
  "the index comes from a push"() {
    const list = [1];
    list[list.push(2)] = list.length;
    return list;
  },
  "the added value changes the element"() {
    const list = [1, 2, 3];
    list[0] += ((list[0] = 100), 5);
    return list;
  },
  "the added value shrinks the list"() {
    const list = [1, 2, 3];
    list[2] += ((list.length = 0), 5);
    return list;
  },
  "the new length comes from a pop"() {
    const list = [1, 2, 3, 1];
    list.length = list.pop();
    return list;
  },
  "the new length comes from a push"() {
    const list = [1];
    list.length = list.push(2, 3) - 1;
    return list;
  },
  "the order of list, key and value"() {
    noted("list", [1])[noted("key", 0)] = noted("value", 2);
    return log.slice();
  },
  "the order with a key that is an object"() {
    noted("list", [1])[{ toString: () => noted("toString", "0") }] = noted("value", 2);
    return log.slice();
  },
  "the order when the list is null"() {
    try {
      noted("list", null)[noted("key", 0)] = noted("value", 2);
    } catch (error) {
      log.push(error.constructor.name);
    }
    return log.slice();
  },
  "the order of a call on null"() {
    try {
      noted("list", null).push(noted("argument", 1));
    } catch (error) {
      log.push(error.constructor.name);
    }
    return log.slice();
  },
  "the order of a call of a missing method"() {
    try {
      noted("list", {}).push(noted("argument", 1));
    } catch (error) {
      log.push(error.constructor.name);
    }
    return log.slice();
  },
  "the order of a spread and later arguments"() {
    const list = [1, 2];
    return Math.max(...list, list.push(50), ...list);
  },
  "the order inside a literal"() {
    const list = [1, 2];
    return [list.length, ...list, list.push(3), ...list, list.length];
  },
  "the order inside a pattern"() {
    const list = [1, 2, 3];
    const [a = noted("default a", "a"), b = list.pop(), c = noted("default c", "c")] = list;
    return [a, b, c, log.slice()];
  },
  "a pattern that stores into the list it reads"() {
    const list = [1, 2, 3];
    [list[2], list[1], list[0]] = list;
    return list;
  },
  "a swap inside one list"() {
    const list = [1, 2, 3];
    [list[0], list[2]] = [list[2], list[0]];
    return list;
  },
  "a comparison that changes the length in the loop head"() {
    const list = [1, 2, 3, 4, 5, 6];
    let turns = 0;
    for (let i = 0; i < list.length; i += list.pop() > 0 ? 1 : 0) turns++;
    return [turns, list];
  },
};

for (let i = 0; i < 300; i++) {
  for (const name in cases) {
    log.length = 0;
    try {
      cases[name]();
    } catch {}
  }
}

for (const name in cases) {
  log.length = 0;
  attempt(name, cases[name]);
}

// GENERATED: noted attempt toString
// CHECK-LABEL: function {{*}}name="noted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|number|string|symbol|bigint|object flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v9, -, v11 calleeName="describe"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v14 = Add v8, v13
// CHECK-NEXT: v15 = Call v6, v4, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v16 = CatchValue
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = String string=": threw "
// CHECK-NEXT: v23 = Add v0, v22
// CHECK-NEXT: v24 = PropGet v16 key="constructor"
// CHECK-NEXT: v25 = PropGet v24 key="name"
// CHECK-NEXT: v26 = Add v23, v25
// CHECK-NEXT: v27 = Call v21, v19, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toString"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v1 = String string="toString"
// CHECK-NEXT: v2 = String string="0"
// CHECK-NEXT: v3 = Call v0, -, v1, v2 calleeName="noted"
// CHECK-NEXT: ReturnCall v3
// CHECK-NEXT: }
