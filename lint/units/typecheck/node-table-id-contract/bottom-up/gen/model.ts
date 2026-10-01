// The model of one node definition of _scripts/ast.json: its Go struct fields, its slots and its factory parameters.
import type { MemberInfo, NodeType } from "/workspace/ref/typescript-go/_scripts/schema.ts";
import { api } from "/workspace/ref/typescript-go/_scripts/schema.ts";
import { field, snake } from "./names.ts";

export type Slot =
  | "Node"
  | "NodeList"
  | "ModifierList"
  | "RawNodeList"
  | "Text"
  | "Bool"
  | "Kind"
  | "TokenFlags"
  | "Int"
  | "TypeId"
  | "FlowNode"
  | "FlowList";

export interface Late {
  bit: string;
  rustType: "SymbolId" | "SymbolTableId" | "NodeId" | "FlowNodeId";
  read: string;
}

// The eight fields that only the binder writes, by their Go name.
export const LATE: Record<string, Late> = {
  Symbol: { bit: "LATE_SYMBOL", rustType: "SymbolId", read: "late_symbol" },
  LocalSymbol: { bit: "LATE_LOCAL_SYMBOL", rustType: "SymbolId", read: "late_symbol" },
  Locals: { bit: "LATE_LOCALS", rustType: "SymbolTableId", read: "late_table" },
  NextContainer: { bit: "LATE_NEXT_CONTAINER", rustType: "NodeId", read: "late_node" },
  FlowNode: { bit: "LATE_FLOW_NODE", rustType: "FlowNodeId", read: "late_flow" },
  EndFlowNode: { bit: "LATE_END_FLOW_NODE", rustType: "FlowNodeId", read: "late_flow" },
  ReturnFlowNode: { bit: "LATE_RETURN_FLOW_NODE", rustType: "FlowNodeId", read: "late_flow" },
  FallthroughFlowNode: { bit: "LATE_FALLTHROUGH_FLOW_NODE", rustType: "FlowNodeId", read: "late_flow" },
};
export const LATE_ORDER = Object.keys(LATE);

export interface Field {
  goName: string;
  rust: string;
  slot?: Slot;
  index?: number;
  late?: Late;
  // A raw list of strings, stored joined.
  joined?: boolean;
  bitmask?: string;
  optional: boolean;
  visit?: string;
  isToken?: boolean;
}

export interface Param {
  goName: string;
  rust: string;
  kind: "kind" | "flags" | "slot";
  field?: Field;
  bitmask?: string;
}

export interface Def {
  name: string;
  rust: string;
  kinds: string[];
  primaryKind: string;
  kindAliases: string[];
  kindParam: boolean;
  // The kind is a type parameter of the definition (Token, KeywordExpression, KeywordTypeNode).
  kindIsTypeParameter: boolean;
  multiKind: boolean;
  kindTypes: string[];
  slots: Field[];
  lates: Field[];
  params: Param[];
  children: { index: number; visit: string }[];
  handWritten: boolean;
  handWrittenVisitor: boolean;
  hasText: boolean;
  bases: string[];
}

function slotOf(m: MemberInfo): { slot?: Slot; joined?: boolean; flags?: boolean; skip?: string } {
  const t = m.type;
  if (t.kind === "primitive") {
    switch (t.name) {
      case "NodeFlags":
        return { flags: true };
      case "TokenFlags":
        return { slot: "TokenFlags" };
      case "bool":
      case "boolean":
        return { slot: "Bool" };
      case "string":
        return { slot: "Text" };
      case "any":
        return { slot: "TypeId" };
      case "int":
        return { slot: "Int" };
      default:
        return { skip: `primitive ${t.name}` };
    }
  }
  if (t.kind === "list") {
    if (t.listKind === "raw") {
      return t.elementType.baseKind() === "node" ? { slot: "RawNodeList" } : { slot: "Text", joined: true };
    }
    return { slot: t.listKind === "ModifierList" ? "ModifierList" : "NodeList" };
  }
  switch (t.baseKind()) {
    case "node":
      return { slot: "Node" };
    case "list":
      return { slot: "NodeList" };
    case "kind":
      return { slot: "Kind" };
    default:
      return { skip: `type ${t.kind}` };
  }
}

// Upstream embeds the bases that have no field first (generate-go-ast.ts goEmbeds); the order of fields is the same.
function baseFields(key: string, seen: Set<string>, out: { base: string; member: MemberInfo }[]): void {
  const base = api.getBase(key);
  if (!base || seen.has(key)) return;
  seen.add(key);
  for (const ext of base.extendsKeys) baseFields(ext, seen, out);
  for (const f of base.fields) out.push({ base: key, member: f });
}

export const problems: string[] = [];

export function buildDef(node: NodeType): Def {
  const schemaMembers = node.members.filter(m => !m.noFactory);
  const kindMember = schemaMembers.find(m => m.isKindParam());
  const slots: Field[] = [];
  const lates: Field[] = [];
  const params: Param[] = [];
  const children: { index: number; visit: string }[] = [];
  const taken = new Set<string>();

  const addLate = (goName: string) => {
    const late = LATE[goName];
    if (!late) {
      problems.push(`${node.name}.${goName}: a goOnly field that is no late field`);
      return;
    }
    if (lates.some(f => f.goName === goName)) return;
    lates.push({ goName, rust: snake(goName), late, optional: true });
  };

  if (kindMember) params.push({ goName: "Kind", rust: "kind", kind: "kind" });
  for (const m of schemaMembers) {
    if (m.isKindParam()) continue;
    taken.add(m.name);
    if (m.goOnly) {
      addLate(m.name);
      continue;
    }
    const s = slotOf(m);
    if (s.flags) {
      params.push({ goName: m.name, rust: field(m.name), kind: "flags", bitmask: m.bitmask });
      continue;
    }
    if (!s.slot) {
      problems.push(`${node.name}.${m.name}: ${s.skip}`);
      continue;
    }
    const t = m.type;
    const f: Field = {
      goName: m.name,
      rust: field(m.name),
      slot: s.slot,
      index: slots.length,
      joined: s.joined,
      bitmask: m.bitmask,
      optional: m.optional,
      visit: m.visit,
      isToken: t.kind === "primitive" && t.name === "Token",
    };
    slots.push(f);
    params.push({ goName: m.name, rust: f.rust, kind: "slot", field: f, bitmask: m.bitmask });
    if (m.isChild()) {
      const visit = m.visit
        ? m.visit.charAt(0).toUpperCase() + m.visit.slice(1)
        : s.slot === "ModifierList"
          ? "Modifiers"
          : s.slot === "NodeList"
            ? "Nodes"
            : s.slot === "RawNodeList"
              ? "RawNodes"
              : f.isToken
                ? "Token"
                : "Node";
      children.push({ index: f.index!, visit });
    }
  }
  // Members that the Go struct has and the factory does not set.
  for (const m of node.members) {
    if (taken.has(m.name) || m.isKindParam() || m.noGo || m.inherited) continue;
    taken.add(m.name);
    if (m.goOnly) {
      addLate(m.name);
      continue;
    }
    problems.push(`${node.name}.${m.name}: own member outside the factory`);
  }
  const inherited: { base: string; member: MemberInfo }[] = [];
  const bases = new Set<string>();
  for (const ext of node.extendsKeys) baseFields(ext, bases, inherited);
  for (const { base, member } of inherited) {
    if (member.noGo) continue;
    if (member.goOnly) {
      if (member.name !== "facts") addLate(member.name);
      continue;
    }
    if (taken.has(member.name)) continue;
    if (base === "NodeBase" && member.name === "Flags") continue;
    taken.add(member.name);
    const s = slotOf(member);
    if (!s.slot) {
      problems.push(`${node.name}.${member.name} of ${base}: ${s.skip ?? "flags"}`);
      continue;
    }
    slots.push({ goName: member.name, rust: field(member.name), slot: s.slot, index: slots.length, joined: s.joined, optional: true });
  }
  lates.sort((a, b) => LATE_ORDER.indexOf(a.goName) - LATE_ORDER.indexOf(b.goName));
  const kinds = node.allKinds().map(k => k.name);
  return {
    name: node.name,
    rust: snake(node.name),
    kinds,
    primaryKind: node.syntaxKindName,
    kindAliases: node.kindAliases,
    kindParam: !!kindMember,
    kindIsTypeParameter: node.kindType.kind === "typeParameter",
    multiKind: node.isMultiKind(),
    kindTypes: node.kindTypes().map(k => k.name),
    slots,
    lates,
    params,
    children,
    handWritten: node.handWritten,
    handWrittenVisitor: node.handWrittenVisitor,
    hasText: slots.some(f => f.slot === "Text"),
    bases: [...bases],
  };
}

// The two nodes that ast/flow.go writes by hand. Their kind is Unknown.
export function flowDefs(): Def[] {
  const mk = (name: string, fields: [string, Slot][]): Def => ({
    name,
    rust: snake(name),
    kinds: [],
    primaryKind: "Unknown",
    kindAliases: [],
    kindParam: false,
    kindIsTypeParameter: false,
    multiKind: false,
    kindTypes: [],
    slots: fields.map(([goName, slot], index) => ({ goName, rust: field(goName), slot, index, optional: false })),
    lates: [],
    params: [],
    children: [],
    handWritten: true,
    handWrittenVisitor: false,
    hasText: false,
    bases: ["NodeBase"],
  });
  return [
    mk("FlowSwitchClauseData", [
      ["SwitchStatement", "Node"],
      ["ClauseStart", "Int"],
      ["ClauseEnd", "Int"],
    ]),
    mk("FlowReduceLabelData", [
      ["Target", "FlowNode"],
      ["Antecedents", "FlowList"],
    ]),
  ];
}

export function allDefs(): Def[] {
  return [...api.nodes().map(buildDef), ...flowDefs()];
}
