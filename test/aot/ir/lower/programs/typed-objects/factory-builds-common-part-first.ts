// RUN: lower
// OPTIONS: builtin-modules

// A factory of syntax nodes: a base factory makes the common part, the factory of each kind of node stores the rest. Two kinds share one type that names no kind, and a smaller type names one of the two.
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Sym { name: string }
interface Node { readonly kind: number; readonly pos: number; readonly end: number; readonly flags: number; readonly parent: Node }
interface Identifier extends Node { readonly kind: 1; readonly text: string }
interface Declaration extends Node { symbol: Sym; localSymbol?: Sym }
interface Tag extends Node { readonly parent: Node; readonly tagName: Identifier; readonly comment?: string }
interface PropertyLikeTag extends Tag, Declaration { readonly name: Identifier; readonly typeExpression?: Node; readonly isNameFirst: boolean; readonly isBracketed: boolean }
interface PropertyTag extends PropertyLikeTag { readonly kind: 2 }
interface ParameterTag extends PropertyLikeTag { readonly kind: 3 }
interface TemplateTag extends Tag { readonly kind: 4; readonly constraint: Node | undefined }
function NodeObject(this: Mutable<Node>, kind: number, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.flags = 0; this.parent = undefined!; }
const allocator = { getNodeConstructor: () => NodeObject as any as new (kind: number, pos: number, end: number) => Node };
let NodeConstructor: new (kind: number, pos: number, end: number) => Node;
const baseFactory = { createBaseNode(kind: number): Node { return new (NodeConstructor || (NodeConstructor = allocator.getNodeConstructor()))(kind, -1, -1); } };
function createBaseNode<T extends Node>(kind: T["kind"]) { return baseFactory.createBaseNode(kind) as Mutable<T>; }
function createBaseDeclaration<T extends Declaration>(kind: T["kind"]) { const node = createBaseNode(kind); node.symbol = undefined!; node.localSymbol = undefined; return node; }
function createBaseTag<T extends Tag>(kind: T["kind"], tagName: Identifier, comment: string | undefined) { const node = createBaseNode<T>(kind); node.tagName = tagName; node.comment = comment; return node; }
function createBaseTagDeclaration<T extends Tag & Declaration>(kind: T["kind"], tagName: Identifier, comment: string | undefined) { const node = createBaseDeclaration<T>(kind); node.tagName = tagName; node.comment = comment; return node; }
function createIdentifier(text: string): Identifier { const node = createBaseNode<Identifier>(1); node.text = text; return node; }
function createParameterTag(tagName: Identifier | undefined, name: Identifier, isBracketed: boolean, typeExpression?: Node, isNameFirst?: boolean, comment?: string): ParameterTag {
  const node = createBaseTagDeclaration<ParameterTag>(3, tagName ?? createIdentifier("param"), comment);
  node.typeExpression = typeExpression; node.name = name; node.isNameFirst = !!isNameFirst; node.isBracketed = isBracketed; return node;
}
function createPropertyTag(tagName: Identifier | undefined, name: Identifier, isBracketed: boolean): PropertyTag {
  const node = createBaseTagDeclaration<PropertyTag>(2, tagName ?? createIdentifier("prop"), undefined);
  node.typeExpression = undefined; node.name = name; node.isNameFirst = false; node.isBracketed = isBracketed; return node;
}
function createTemplateTag(constraint: Node | undefined): TemplateTag { const node = createBaseTag<TemplateTag>(4, createIdentifier("template"), undefined); node.constraint = constraint; return node; }
interface Named extends Node { readonly kind: 3 | 6; readonly name: Identifier }
interface Other extends Named { readonly kind: 6 }
function createBaseNamed<T extends Named>(kind: T["kind"], name: Identifier) { const node = createBaseNode<T>(kind); node.name = name; return node; }
function createOther(name: Identifier): Other { return createBaseNamed<Other>(6, name); }
function nameOf(named: Named): string { return named.kind + named.name.text; }
function describe(tag: PropertyLikeTag): string { return tag.kind + ":" + tag.tagName.text + ":" + tag.name.text + ":" + tag.isBracketed + ":" + tag.isNameFirst + ":" + (tag.comment ?? "-"); }
const tags: Tag[] = [];
for (let i = 0; i < 3; i++) {
  const p = createParameterTag(undefined, createIdentifier("x" + i), i === 1, undefined, true, "c" + i);
  const q = createPropertyTag(createIdentifier("property"), createIdentifier("y" + i), false);
  tags.push(p, q, createTemplateTag(p));
  console.log(describe(p), describe(q));
}
console.log(nameOf(createOther(createIdentifier("o"))));
console.log(tags.map(t => t.kind + t.tagName.text).join());

// GENERATED: createBaseNode createBaseNamed createParameterTag getNodeConstructor
// CHECK-LABEL: function {{*}}name="createBaseNode"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="baseFactory"
// CHECK-NEXT: v3 = PropGet v2 key="createBaseNode"
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeKey="createBaseNode" calleeName="baseFactory.createBaseNode"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createBaseNamed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=int[3, 6]}, {type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: int[3, 6], v1: undefined|null|[[L_2]]):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="createBaseNode"
// CHECK-NEXT: PropSet v3, v1 key="name"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createParameterTag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=6 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[OmitsNull]}, {type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}, {type=boolean}, {type=undefined|null|[[L_4]] flags=[OmitsNull]}, {type=undefined|boolean}, {type=undefined|null|string flags=[OmitsNull]}] results=[{type=undefined|null|[[L_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]], v1: undefined|null|[[L_2]], v2: boolean, v3: undefined|null|[[L_4]], v4: undefined|boolean, v5: undefined|null|string):
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v7 = Integer integer=3
// CHECK-NEXT: v8 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v11 = String string="param"
// CHECK-NEXT: v12 = Call v10, -, v11 calleeName="createIdentifier"
// CHECK-NEXT: Jump -> next b3(v12)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b3(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = Call v6, -, v7, v14, v5 calleeName="createBaseTagDeclaration"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v16, v3 key="typeExpression"
// CHECK-NEXT: PropSet v16, v1 key="name"
// CHECK-NEXT: v19 = ToBoolean v4
// CHECK-NEXT: v20 = LogicalNot v19
// CHECK-NEXT: v21 = ToBoolean v20
// CHECK-NEXT: v22 = LogicalNot v21
// CHECK-NEXT: PropSet v16, v22 key="isNameFirst"
// CHECK-NEXT: PropSet v16, v2 key="isBracketed"
// CHECK-NEXT: v25 = Convert v16 declared={type=undefined|null|[[L_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getNodeConstructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createBaseNode"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="NodeConstructor"
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="NodeConstructor"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="allocator"
// CHECK-NEXT: v10 = PropGet v9 key="getNodeConstructor"
// CHECK-NEXT: v11 = Call v10, v9 calleeKey="getNodeConstructor" calleeName="allocator.getNodeConstructor"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_12]] flags=[OmitsNull]}
// CHECK-NEXT: PutModuleVariable v12 variable=[[g_10]]
// CHECK-NEXT: Jump -> next b3(v11)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = Integer integer=-1
// CHECK-NEXT: v16 = Integer integer=-1
// CHECK-NEXT: v17 = Construct v14, -, v0, v15, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
