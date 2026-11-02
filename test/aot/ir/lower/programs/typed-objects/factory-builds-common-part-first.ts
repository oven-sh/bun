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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="baseFactory"
// CHECK-NEXT: v3 = PropGet v2 key="createBaseNode"
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeKey="createBaseNode" calleeName="baseFactory.createBaseNode"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createBaseNamed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=int[3, 6] site=[[w_5]]}, {type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: int[3, 6], v1: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="createBaseNode"
// CHECK-NEXT: v4 = Convert v1 declared={type=undefined|null|[[L_6]] site=[[w_9]]}
// CHECK-NEXT: PropSet v3, v4 key="name"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createParameterTag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=6 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] site=[[w_10]] flags=[OmitsNull]}, {type=undefined|null|[[L_6]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}, {type=boolean site=[[w_12]]}, {type=undefined|null|[[L_3]] site=[[w_13]] flags=[OmitsNull]}, {type=undefined|boolean site=[[w_14]]}, {type=undefined|null|string site=[[w_15]] flags=[OmitsNull]}] results=[{type=undefined|null|[[L_16]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]], v1: undefined|null|[[L_6]], v2: boolean, v3: undefined|null|[[L_3]], v4: undefined|boolean, v5: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v7 = Integer integer=3
// CHECK-NEXT: v8 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v11 = String string="param"
// CHECK-NEXT: v12 = Call v10, -, v11 calleeName="createIdentifier"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_6]] site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5(v13)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Jump -> next b5(v14)
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: v16 = Call v6, -, v7, v15, v5 calleeName="createBaseTagDeclaration"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_16]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v18 = Convert v3 declared={type=undefined|null|[[L_3]] site=[[w_22]] flags=[OmitsNull]}
// CHECK-NEXT: PropSet v17, v18 key="typeExpression"
// CHECK-NEXT: v20 = Convert v1 declared={type=undefined|null|[[L_6]] site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v17, v20 key="name"
// CHECK-NEXT: v22 = ToBoolean v4
// CHECK-NEXT: v23 = LogicalNot v22
// CHECK-NEXT: v24 = ToBoolean v23
// CHECK-NEXT: v25 = LogicalNot v24
// CHECK-NEXT: v26 = Convert v25 declared={type=boolean site=[[w_24]]}
// CHECK-NEXT: PropSet v17, v26 key="isNameFirst"
// CHECK-NEXT: v28 = Convert v2 declared={type=boolean site=[[w_25]]}
// CHECK-NEXT: PropSet v17, v28 key="isBracketed"
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getNodeConstructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|[[f_26]] site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_28]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_29]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_26]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_26]] site=[[w_30]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createBaseNode"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_31]]}] results=[{type=undefined|null|[[L_3]] site=[[w_32]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_33]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_34]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="NodeConstructor"
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b5(v4)
// CHECK-NEXT: b3(v5):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_34]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="NodeConstructor"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_35]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="allocator"
// CHECK-NEXT: v10 = PropGet v9 key="getNodeConstructor"
// CHECK-NEXT: v11 = Call v10, v9 calleeKey="getNodeConstructor" calleeName="allocator.getNodeConstructor"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_26]] site=[[w_36]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_37]] site=[[w_38]] flags=[OmitsNull]}
// CHECK-NEXT: PutModuleVariable v13 variable=[[g_34]]
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: v16 = Integer integer=-1
// CHECK-NEXT: v17 = Integer integer=-1
// CHECK-NEXT: v18 = Construct v15, -, v0, v16, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[L_3]] site=[[w_39]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
