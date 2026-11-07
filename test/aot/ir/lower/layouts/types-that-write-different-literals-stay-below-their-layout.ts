// RUN: link
// CHECK: layout {{*}}name="Seven" module=[[entry]] {{*}}{key="tag" declared={type=int[7, 9]} flags=[IsRequired]}
// CHECK: layout [[shared]] name="Negate" module=[[entry]] {{*}}{key="kind" declared={type=int[1, 3]} flags=[IsRequired]}{{*}}flags=[IsNeverAllocated]
// CHECK: layout {{*}}module=[[entry]] {{*}}{key="kind" declared={type=1} flags=[IsRequired]}{{*}}supertypes=[{{*}}[[shared]]] flags=[IsNeverAllocated]
// CHECK-NEXT: layout {{*}}module=[[entry]] {{*}}{key="kind" declared={type=3} flags=[IsRequired]}{{*}}supertypes=[{{*}}[[shared]]] flags=[IsNeverAllocated]
// CHECK-NEXT: variable g0
// CHECK: function {{*}}name="operandsOf" {{*}}parameters=[{type=undefined|null|[[shared]] site=w{{*}}}, {type=undefined|null|[[shared]] site=w{{*}}}]

// Negate and Not have the same names, so they share a layout, which every position of either names. Its `kind` holds what either writes, and a type only
// bounds its integers: 1 to 3, though nobody writes 2. The layout describes objects that NodeObject makes, whose `this` is a Node, and which names such an
// object will have hangs on its literal. So what is declared under each literal stays in the program, as a type below the layout that no position names.
// Seven and Nine share a layout too. No constructor makes an object that is taken for one: a literal is born with its names, and nothing stays below the layout.
interface Node {
  kind: number;
  pos: number;
}

interface Negate extends Node {
  kind: 1;
  operand: Node;
}

interface Not extends Node {
  kind: 3;
  operand: Node;
}

interface Seven {
  tag: 7;
  size: number;
}

interface Nine {
  tag: 9;
  size: number;
}

export function NodeObject(this: Node, kind: number, pos: number) {
  this.kind = kind;
  this.pos = pos;
}

export function setOperand(node: Negate, operand: Node) {
  node.operand = operand;
}

export function operandsOf(negate: Negate, not: Not) {
  return [negate.operand, not.operand];
}

export function make(size: number): [Seven, Nine] {
  return [
    { tag: 7, size },
    { tag: 9, size },
  ];
}
