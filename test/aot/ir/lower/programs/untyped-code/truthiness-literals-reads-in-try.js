// RUN: lower
// OPTIONS: builtin-modules

// Tests for truthiness, object literals, constructors and reads of properties inside try, catch and finally: nested, in a generator, behind await, with throws before and after them.
const lines = [];
function say(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
}

const values = [undefined, null, false, true, 0, -0, 1, NaN, 0.5, "", "a", [], {}, () => 0, Symbol.iterator, 0n, 7n];

function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.sum = function () {
  return this.x + this.y;
};

function classify(value, thrower) {
  let trail = "";
  try {
    if (value) trail += "t";
    else trail += "f";
    const made = { value, trail, nested: { deep: !value } };
    if (made.nested.deep) trail += "d";
    const point = new Point(trail.length, 2);
    point.z = made.absent;
    if (point.z) trail += "z";
    if (point.sum() > 3) trail += "s";
    if (thrower) thrower(trail);
    trail += "!";
  } catch (error) {
    if (error) trail += "c" + (typeof error === "function" || typeof error === "object" ? error.message ?? typeof error : String(error));
    else trail += "c-";
  } finally {
    if (!value) trail += "n";
    try {
      if (trail.length > 6 && value) throw trail.length;
    } catch (length) {
      trail += length ? "L" : "l";
    }
  }
  return trail;
}

say(values.map(value => classify(value, null)));
say(values.map(value => classify(value, trail => { throw new Error(trail); })));
say(values.map(value => classify(value, () => { throw value; })));

function whereThrown(depth, value) {
  try {
    if (value) {
      if (depth) return whereThrown(depth - 1, value);
      null.property;
    }
    return "nothing thrown";
  } catch (error) {
    const stack = String(error.stack).split("\n").filter(line => line.includes("whereThrown")).length;
    return [error.constructor.name, stack];
  }
}
say(whereThrown(0, 1), whereThrown(3, "x"), whereThrown(2, 0));

function* stepping(list) {
  for (const item of list) {
    try {
      if (item) yield { item, kind: typeof item };
      else yield { item: String(item), kind: "falsy" };
    } finally {
      if (item === 1) lines.push("left one");
    }
  }
}
say([...stepping([0, 1, "", "x", null])]);

async function waiting(list) {
  const seen = [];
  for (const item of list) {
    try {
      const got = await item;
      if (got) seen.push({ got });
      else throw got;
    } catch (reason) {
      seen.push(reason ? "reason" : "none");
    }
  }
  return seen;
}
let sum = 0;
for (let i = 0; i < 20000; ++i) {
  try {
    const point = new Point(i, i & 1 ? 0 : "");
    if (point.y) sum += 1;
    else if (point.x) sum += 2;
    if (i % 5000 === 4999) throw point;
  } catch (point) {
    if (point.x) sum += point.x;
  }
}
say("sum", sum);
waiting([1, 0, Promise.resolve(""), Promise.reject(new Error("no")), Promise.resolve({})]).then(seen => {
  say(seen);
  console.log(lines.join("\n"));
});

// GENERATED: Point waiting
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=2 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v3, v1 key="x"
// CHECK-NEXT: v5 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v2 key="y"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="waiting"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=undefined|null|Promise<undefined|null|Array<undefined|null|string|[[L_3]]>> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Data data=[[d_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v5 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v5
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Convert v4 declared={type=undefined|null|Array<undefined|null|string|[[L_3]]> flags=[IsExpected]}
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b20():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b13():
// CHECK-NEXT: v12 = Await v9, v1
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v14) handler=b13():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b13():
// CHECK-NEXT: v15 = PropGet v4 key="push"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v17 = NewObject -, v14 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v18 = FinishObject v17
// CHECK-NEXT: v19 = Call v16, v4, v18 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b13():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b20():
// CHECK-NEXT: Jump -> next b19()
// CHECK-NEXT: b11(v20) handler=b13():
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12() handler=b13():
// CHECK-NEXT: Throw v20
// CHECK-NEXT: b13() role=CatchHandler handler=b20():
// CHECK-NEXT: v21 = CatchValue
// CHECK-NEXT: v22 = PropGet v4 key="push"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v24 = ToBoolean v21
// CHECK-NEXT: Branch v24 -> taken b14(| 0), notTaken b16(| 0)
// CHECK-NEXT: b14(v25) handler=b20():
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b15() handler=b20():
// CHECK-NEXT: v26 = String string="reason"
// CHECK-NEXT: Jump -> next b18(v26)
// CHECK-NEXT: b16(v27) handler=b20():
// CHECK-NEXT: Jump -> next b17()
// CHECK-NEXT: b17() handler=b20():
// CHECK-NEXT: v28 = String string="none"
// CHECK-NEXT: Jump -> next b18(v28)
// CHECK-NEXT: b18(v29) handler=b20():
// CHECK-NEXT: v30 = Call v23, v4, v29 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: Jump -> next b19()
// CHECK-NEXT: b19() handler=b20():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b20() role=IterationCleanup subject=v5:
// CHECK-NEXT: v31 = CatchException
// CHECK-NEXT: IteratorClose v5 completion=Throw
// CHECK-NEXT: Rethrow v31
// CHECK-NEXT: }
