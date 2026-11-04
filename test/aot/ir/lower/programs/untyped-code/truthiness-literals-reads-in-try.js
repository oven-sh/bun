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
// CHECK-NEXT: PropSet v0, v1 key="x"
// CHECK-NEXT: PropSet v0, v2 key="y"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="waiting"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|Array):
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = IteratorResume v3
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v2
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b13():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b8():
// CHECK-NEXT: v8 = Await v7, v1
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v10) handler=b8():
// CHECK-NEXT: v11 = PropGet v2 key="push"
// CHECK-NEXT: v12 = NewObject -, v8 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v13 = FinishObject v12
// CHECK-NEXT: v14 = Call v11, v2, v13 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b7(v15) handler=b8():
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b8() role=CatchHandler handler=b13():
// CHECK-NEXT: v16 = CatchValue
// CHECK-NEXT: v17 = PropGet v2 key="push"
// CHECK-NEXT: v18 = ToBoolean v16
// CHECK-NEXT: Branch v18 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v19) handler=b13():
// CHECK-NEXT: v20 = String string="reason"
// CHECK-NEXT: Jump -> next b11(v20)
// CHECK-NEXT: b10(v21) handler=b13():
// CHECK-NEXT: v22 = String string="none"
// CHECK-NEXT: Jump -> next b11(v22)
// CHECK-NEXT: b11(v23) handler=b13():
// CHECK-NEXT: v24 = Call v17, v2, v23 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12() handler=b13():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b13() role=IterationCleanup subject=v3:
// CHECK-NEXT: v25 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v25
// CHECK-NEXT: }
