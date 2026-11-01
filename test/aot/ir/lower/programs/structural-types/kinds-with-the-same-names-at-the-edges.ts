// RUN: lower
// OPTIONS: builtin-modules

// Expression, Throw and Return statements have the same names, so their objects may share everything but `kind`. Whatever the compiler makes of that,
// each object behaves as the plain object that the constructor function fills.
const enum Kind { Expression = 1, Throw = 2, Return = 3, Identifier = 4, Block = 5, Undeclared = 99 }
interface Node { kind: Kind; pos: number }
interface ExpressionStatement extends Node { kind: Kind.Expression; expression: Node; note?: string }
interface ThrowStatement extends Node { kind: Kind.Throw; expression: Node; note?: string }
interface ReturnStatement extends Node { kind: Kind.Return; expression: Node; note?: string }
interface Identifier extends Node { kind: Kind.Identifier; text: string }
interface Block extends Node { kind: Kind.Block; statements: Node[] }

function NodeObject(this: Node, kind: Kind, pos: number) {
  this.kind = kind;
  this.pos = pos;
}
NodeObject.prototype.describe = function (this: Node) {
  return this.kind + "@" + this.pos + ":" + Object.keys(this).join(",");
};
const NodeConstructor = NodeObject as unknown as new (kind: Kind, pos: number) => Node;
const describe = (node: Node) => (node as unknown as { describe(): string }).describe();

function identifier(text: string): Identifier {
  const node = new NodeConstructor(Kind.Identifier, 0) as Identifier;
  node.text = text;
  return node;
}
function statement(kind: Kind.Expression | Kind.Throw | Kind.Return, expression: Node) {
  const node = new NodeConstructor(kind, 1) as ExpressionStatement | ThrowStatement | ReturnStatement;
  node.expression = expression;
  return node;
}
function textOf(node: ExpressionStatement | ThrowStatement | ReturnStatement): string {
  return (node.expression as Identifier).text + "/" + node.note;
}

const name = identifier("x");
const lines: string[] = [];

// The order of the keys is the order of the stores, which differs from one object to the next.
const first = statement(Kind.Expression, name);
first.note = "late";
const second = new NodeConstructor(Kind.Throw, 2) as ThrowStatement;
second.note = "early";
second.expression = name;
const third = statement(Kind.Return, name);
lines.push(describe(first), describe(second), describe(third), textOf(first), textOf(second), textOf(third));
lines.push(String("note" in third), String(Object.hasOwn(third, "note")), JSON.stringify(third));

// A cast to a kind that the object is not: the name is absent, then stored, then deleted.
const asBlock = third as Node as Block;
lines.push(String(asBlock.statements));
asBlock.statements = [name];
lines.push(describe(third), String(asBlock.statements.length));
delete (asBlock as Partial<Block>).statements;
lines.push(describe(third), String(asBlock.statements));

// `kind` changes after the birth.
(first as Node).kind = Kind.Block;
lines.push(describe(first), String((first as Node as Block).statements), textOf(first));

// A kind that no type declares, used as a statement all the same.
const undeclared = new NodeConstructor(Kind.Undeclared, 3) as ExpressionStatement;
lines.push(describe(undeclared), String(undeclared.expression));
undeclared.expression = name;
lines.push(describe(undeclared), textOf(undeclared));

// Somebody hands in `this`.
const handedIn = { before: true } as unknown as ThrowStatement;
NodeObject.call(handedIn, Kind.Throw, 4);
handedIn.expression = name;
lines.push(Object.keys(handedIn).join(","), textOf(handedIn), String(handedIn instanceof NodeObject));

// Tags that are no integers, or integers in disguise.
for (const odd of [1.5, "1", NaN, -0, 2 ** 32 + 1, undefined, null, true, { valueOf: () => 1 }, 1n]) {
  const node = new NodeConstructor(odd as Kind, 5) as ExpressionStatement;
  node.expression = name;
  lines.push(typeof node.kind + " " + String(Object.is(node.kind, odd)) + " " + Object.keys(node).join(",") + " " + textOf(node));
}

// Many of each, through one function.
let total = 0;
for (let i = 0; i < 3000; i++) {
  const kind = i % 3 === 0 ? Kind.Expression : i % 3 === 1 ? Kind.Throw : Kind.Return;
  const node = statement(kind, i % 5 === 0 ? identifier("n" + i) : name);
  if (i % 7 === 0) node.note = "n";
  total += textOf(node).length + node.kind;
}
lines.push(String(total));
console.log(lines.join("\n"));

// GENERATED: NodeObject statement textOf describe
// CHECK-LABEL: function {{*}}name="NodeObject"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=[[L_1]] site=[[w_2]]} parameters=[{type=i32 site=[[w_3]]}, {type=number site=[[w_4]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: i32, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|[[L_5]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = Convert v1 declared={type=i32 site=[[w_6]]}
// CHECK-NEXT: PropSet v3, v4 key="kind"
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|[[L_5]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = Convert v2 declared={type=number site=[[w_7]]}
// CHECK-NEXT: PropSet v6, v7 key="pos"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="statement"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=i32 site=[[w_8]]}, {type=undefined|null|[[L_5]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: i32, v1: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="NodeConstructor"
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Construct v3, -, v0, v4 calleeName="NodeConstructor"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_5]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_10]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v8 = Convert v1 declared={type=undefined|null|[[L_5]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v7, v8 key="expression"
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="textOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_10]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="expression"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_18]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v3 = PropGet v2 key="text"
// CHECK-NEXT: v4 = String string="/"
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = PropGet v0 key="note"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_22]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_23]] site=[[w_24]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = PropGet v1 key="describe"
// CHECK-NEXT: v3 = Call v2, v1 calleeKey="describe" calleeName="node.describe"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
