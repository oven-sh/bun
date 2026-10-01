// Emits the node definitions: layouts, decoded structs, casts, predicates, the factory, the updater and the base accessors.
import { api } from "/workspace/ref/typescript-go/_scripts/schema.ts";
import type { Def, Field, Param } from "./model.ts";
import { allDefs, LATE, LATE_ORDER, problems } from "./model.ts";
import { GENERATED, snake, upperSnake } from "./names.ts";

const RUST_TYPE: Record<string, string> = {
  Node: "NodeId",
  NodeList: "NodeListId",
  ModifierList: "ModifierListId",
  RawNodeList: "NodeListId",
  Text: "Text<'a>",
  Bool: "bool",
  Kind: "Kind",
  TokenFlags: "TokenFlags",
  Int: "i32",
  TypeId: "TypeId",
  FlowNode: "FlowNodeId",
  FlowList: "FlowListId",
};
const READ: Record<string, string> = {
  Node: "node",
  NodeList: "list",
  ModifierList: "modifiers",
  RawNodeList: "list",
  Text: "text",
  Bool: "bool",
  Kind: "kind",
  TokenFlags: "token_flags",
  Int: "int",
  TypeId: "type_id",
  FlowNode: "flow_node",
  FlowList: "flow_list",
};
const PARAM_TYPE: Record<string, string> = { ...RUST_TYPE, Text: "&[u8]" };

function flagConst(goName: string, prefix: string): string {
  return `${prefix}::${upperSnake(goName.slice(prefix.length))}`;
}

function slotValue(p: Param, textVars: Map<string, string>): string {
  const f = p.field!;
  switch (f.slot) {
    case "Text":
      return textVars.get(f.rust)!;
    case "Bool":
      return `u32::from(${p.rust})`;
    case "Kind":
      return `${p.rust} as u32`;
    case "TokenFlags":
      return p.bitmask ? `(${p.rust} & ${flagConst(p.bitmask, "TokenFlags")}).0 as u32` : `${p.rust}.0 as u32`;
    case "Int":
      return `${p.rust} as u32`;
    default:
      return `${p.rust}.0`;
  }
}

function flagsExpr(d: Def): string {
  const flags = d.params.filter(p => p.kind === "flags");
  if (flags.length === 0) return "NodeFlags::NONE";
  const terms = flags.map(p => (p.bitmask ? `${p.rust} & ${flagConst(p.bitmask, "NodeFlags")}` : p.rust));
  return terms.length === 1 ? terms[0] : terms.map(t => `(${t})`).join(" | ");
}

function paramList(params: Param[]): string {
  return params
    .map(p => (p.kind === "kind" ? "kind: Kind" : p.kind === "flags" ? `${p.rust}: NodeFlags` : `${p.rust}: ${PARAM_TYPE[p.field!.slot!]}`))
    .join(", ");
}

function textLets(d: Def, out: string[]): Map<string, string> {
  const vars = new Map<string, string>();
  for (const p of d.params) {
    if (p.kind === "slot" && p.field!.slot === "Text") {
      const v = `${p.rust}_slot`;
      vars.set(p.rust, v);
      out.push(`        let ${v} = self.text_slot(${p.rust});`);
    }
  }
  return vars;
}

// Every slot of the definition, the ones the factory does not set as 0.
function allSlots(d: Def, textVars: Map<string, string>): string {
  const byField = new Map(d.params.filter(p => p.kind === "slot").map(p => [p.field!.index!, p] as const));
  return d.slots.map(f => (byField.has(f.index!) ? slotValue(byField.get(f.index!)!, textVars) : "0")).join(", ");
}

function emitFactory(d: Def, fnName: string, kind: string, out: string[]): void {
  out.push(`    fn new_${fnName}(&mut self, ${paramList(d.params)}) -> NodeId {`);
  const textVars = textLets(d, out);
  if (d.hasText) out.push("        self.count_text();");
  const kindArg = d.kindParam ? "kind" : `Kind::${kind}`;
  out.push(`        self.alloc_node(Def::${d.name}, ${kindArg}, ${flagsExpr(d)}, &[${allSlots(d, textVars)}])`);
  out.push("    }");
}

function hasUpdate(d: Def): boolean {
  return d.children.length > 0;
}

function emitUpdate(d: Def, out: string[]): void {
  const params = d.params.filter(p => p.kind !== "kind");
  out.push(`    fn update_${d.rust}(&mut self, node: NodeId, ${paramList(params)}) -> NodeId {`);
  const textVars = textLets(d, out);
  const listed = params.filter(p => p.kind === "slot").sort((a, b) => a.field!.index! - b.field!.index!);
  const flags = params.filter(p => p.kind === "flags");
  const flagsArg = flags.length ? `Some(${flags[0].rust})` : "None";
  out.push(`        self.update_node(node, Def::${d.name}, ${flagsArg}, &[${listed.map(p => slotValue(p, textVars)).join(", ")}])`);
  out.push("    }");
}

function emitStruct(d: Def, out: string[]): void {
  const lifetime = d.hasText ? "<'a>" : "";
  out.push("#[derive(Clone, Copy, Default, Debug)]", `pub struct ${d.name}${lifetime} {`);
  for (const f of d.slots) out.push(`    pub ${f.rust}: ${RUST_TYPE[f.slot!]},`);
  for (const f of d.lates) out.push(`    pub ${f.rust}: ${f.late!.rustType},`);
  out.push("}", "");
}

function emitCast(d: Def, out: string[]): void {
  const lifetime = d.hasText ? "<'a>" : "";
  out.push(`    pub fn as_${d.rust}(self, node: NodeId) -> ${d.name}${lifetime} {`);
  if (d.slots.length + d.lates.length === 0) {
    out.push(`        let _ = self.data(node, Def::${d.name});`, `        ${d.name} {}`, "    }");
    return;
  }
  out.push(`        let Some(d) = self.data(node, Def::${d.name}) else {`, `            return ${d.name}::default();`, "        };");
  out.push(`        ${d.name} {`);
  for (const f of d.slots) out.push(`            ${f.rust}: d.${READ[f.slot!]}(${f.index}),`);
  for (const f of d.lates) out.push(`            ${f.rust}: d.${f.late!.read}(${f.late!.bit}),`);
  out.push("        }", "    }");
}

function emitPredicates(d: Def, out: string[]): void {
  if (d.kinds.length === 0) return;
  const one = (name: string, kind: string) =>
    out.push(`pub fn is_${snake(name)}(a: Ast<'_>, node: NodeId) -> bool {`, `    a.kind(node) == Kind::${kind}`, "}", "");
  if (d.kindIsTypeParameter) {
    out.push(`pub fn is_${d.rust}(a: Ast<'_>, node: NodeId) -> bool {`);
    out.push(`    matches!(a.kind(node), ${d.kindTypes.map(k => `Kind::${k}`).join(" | ")})`, "}", "");
    return;
  }
  if (d.multiKind) {
    for (const k of d.kindTypes) one(k, k);
    return;
  }
  one(d.name, d.primaryKind);
  for (const alias of d.kindAliases) one(alias, alias);
}

interface BaseAccessor {
  base: string;
  fn: string;
  fields: string[];
}

// The bases that upstream reaches through a method of nodeData.
const BASE_ACCESSORS: BaseAccessor[] = [
  { base: "FunctionLikeBase", fn: "function_like_data", fields: ["TypeParameters", "Parameters", "Type", "FullSignature"] },
  { base: "ClassLikeBase", fn: "class_like_data", fields: ["modifiers", "name", "TypeParameters", "HeritageClauses", "Members"] },
  { base: "BodyBase", fn: "body_data", fields: ["AsteriskToken", "Body"] },
  { base: "LiteralLikeNodeBase", fn: "literal_like_data", fields: ["Text", "TokenFlags"] },
  { base: "TemplateLiteralLikeNodeBase", fn: "template_literal_like_data", fields: ["Text", "TokenFlags", "RawText", "TemplateFlags"] },
];

export function generateAst(): { text: string; stats: Record<string, number> } {
  const defs = allDefs();
  const out: string[] = [GENERATED("gen/gen-ast.ts", "_scripts/ast.json"), ""];
  out.push(
    "use crate::ast::factory::{NodeSink, NodeUpdate};",
    "use crate::ast::flags_generated::{NodeFlags, TokenFlags};",
    "use crate::ast::kind_generated::{KIND_COUNT, Kind};",
    "use crate::ast::layout::{",
    "    ChildSlot, DefInfo, LATE_END_FLOW_NODE, LATE_FALLTHROUGH_FLOW_NODE, LATE_FLOW_NODE, LATE_LOCAL_SYMBOL, LATE_LOCALS,",
    "    LATE_NEXT_CONTAINER, LATE_RETURN_FLOW_NODE, LATE_SYMBOL, SlotInfo, SlotType, VisitTag,",
    "};",
    "use crate::ast::reader::Ast;",
    "use crate::tscore::golang::Text;",
    "use crate::tscore::ids::{FlowListId, FlowNodeId, ModifierListId, NodeId, NodeListId, SymbolId, SymbolTableId, TypeId};",
    "",
  );

  // The definitions.
  out.push("#[repr(u8)]", "#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]", "pub enum Def {", "    #[default]", "    None,");
  for (const d of defs) out.push(`    ${d.name},`);
  out.push("}", "", `pub const DEF_COUNT: usize = ${defs.length + 1};`, "");
  out.push("#[rustfmt::skip]", `static DEF_INFOS: [DefInfo; DEF_COUNT] = [`);
  out.push('    DefInfo { name: "None", slots: &[], children: &[], children_alt: &[], late: 0 },');
  for (const d of defs) {
    const slots = d.slots.map(f => `SlotInfo { name: "${f.goName}", ty: SlotType::${f.slot} }`).join(", ");
    const child = (c: { index: number; visit: string }) => `ChildSlot { slot: ${c.index}, visit: VisitTag::${c.visit} }`;
    const children = d.children.map(child).join(", ");
    let alt = "";
    if (d.handWrittenVisitor) {
      // ast.go forEachChild_JSDocParameterOrPropertyTag: the name comes before the type when IsNameFirst is set.
      if (d.name !== "JSDocParameterOrPropertyTag") problems.push(`${d.name}: a hand-written visitor that the generator does not know`);
      const byName = (n: string) => d.children.find(c => d.slots[c.index].goName === n)!;
      alt = [byName("TagName"), byName("name"), byName("TypeExpression"), byName("Comment")].map(child).join(", ");
    }
    const late = d.lates.length ? d.lates.map(l => l.late!.bit).join(" | ") : "0";
    const primary = d.handWrittenVisitor
      ? ["TagName", "TypeExpression", "name", "Comment"].map(n => child(d.children.find(c => d.slots[c.index].goName === n)!)).join(", ")
      : children;
    out.push(`    DefInfo { name: "${d.name}", slots: &[${slots}], children: &[${primary}], children_alt: &[${alt}], late: ${late} },`);
  }
  out.push("];", "");
  out.push("#[rustfmt::skip]", `static DEFS: [Def; DEF_COUNT] = [`, "    Def::None,", ...defs.map(d => `    Def::${d.name},`), "];", "");

  // The definition that a kind belongs to: the one that is not Token first, Token second when the kind is a token kind too.
  const kindNames = api.kindElements().filter(e => e.name).map(e => e.name!);
  const byKind = new Map<string, string[]>();
  for (const d of defs) for (const k of d.kinds) byKind.set(k, [...(byKind.get(k) ?? []), d.name]);
  out.push("#[rustfmt::skip]", `static KIND_DEFS: [(Def, Def); KIND_COUNT + 1] = [`);
  let ambiguous = 0;
  for (const k of kindNames) {
    const list = byKind.get(k) ?? [];
    const main = list.find(n => n !== "Token") ?? list[0] ?? "None";
    const second = list.length > 1 ? "Token" : "None";
    if (list.length > 1) ambiguous++;
    if (list.length > 2) problems.push(`kind ${k}: ${list.length} definitions`);
    out.push(`    (Def::${main}, Def::${second}),`);
  }
  out.push("    (Def::None, Def::None),", "];", "");
  out.push(
    "impl Def {",
    "    pub fn from_u8(value: u8) -> Def {",
    "        DEFS.get(value as usize).copied().unwrap_or(Def::None)",
    "    }",
    "    pub fn info(self) -> &'static DefInfo {",
    "        DEF_INFOS.get(self as usize).unwrap_or(&DEF_INFOS[0])",
    "    }",
    "    // The definitions of a kind: the node definition, then Token when the kind is a token kind as well.",
    "    pub fn of_kind(kind: Kind) -> (Def, Def) {",
    "        KIND_DEFS.get(kind as usize).copied().unwrap_or((Def::None, Def::None))",
    "    }",
    "}",
    "",
  );

  // Name() and Modifiers() of nodeData.
  const slotTable = (name: string, goName: string) => {
    out.push("#[rustfmt::skip]", `static ${name}: [u8; DEF_COUNT] = [`, "    255,");
    for (const d of defs) {
      const f = d.slots.find(s => s.goName === goName);
      out.push(`    ${f ? f.index : 255},`);
    }
    out.push("];", "");
  };
  slotTable("NAME_SLOT", "name");
  slotTable("MODIFIERS_SLOT", "modifiers");

  for (const d of defs) {
    emitStruct(d, out);
    emitPredicates(d, out);
  }

  for (const acc of BASE_ACCESSORS) {
    const base = api.getBase(acc.base)!;
    const fields = acc.fields.map(n => {
      const owner = defs.find(d => d.bases.includes(acc.base))!;
      const f = owner.slots.find(s => s.goName === n);
      if (!f) problems.push(`${acc.base}.${n}: no slot in ${owner.name}`);
      return f!;
    });
    const hasText = fields.some(f => f.slot === "Text");
    out.push("#[derive(Clone, Copy, Default, Debug)]", `pub struct ${base.key}${hasText ? "<'a>" : ""} {`);
    for (const f of fields) out.push(`    pub ${f.rust}: ${RUST_TYPE[f.slot!]},`);
    out.push("}", "");
    out.push("#[rustfmt::skip]", `static ${upperSnake(acc.base)}_SLOTS: [[u8; ${fields.length}]; DEF_COUNT] = [`, `    [255; ${fields.length}],`);
    for (const d of defs) {
      if (!d.bases.includes(acc.base)) {
        out.push(`    [255; ${fields.length}],`);
        continue;
      }
      const idx = fields.map(f => {
        const own = d.slots.find(s => s.goName === f.goName);
        if (!own) problems.push(`${d.name}: base ${acc.base} without slot ${f.goName}`);
        return own ? own.index : 255;
      });
      out.push(`    [${idx.join(", ")}],`);
    }
    out.push("];", "");
  }

  out.push("impl<'a> Ast<'a> {");
  for (const d of defs) emitCast(d, out);
  out.push(
    "    // Name() of nodeData: the name of a node that has one, else nil.",
    "    pub fn name(self, node: NodeId) -> NodeId {",
    "        match self.data_any(node) {",
    "            Some((def, d)) => d.node(usize::from(NAME_SLOT.get(def as usize).copied().unwrap_or(255))),",
    "            None => NodeId::NIL,",
    "        }",
    "    }",
    "    // Modifiers() of nodeData.",
    "    pub fn modifiers(self, node: NodeId) -> ModifierListId {",
    "        match self.data_any(node) {",
    "            Some((def, d)) => d.modifiers(usize::from(MODIFIERS_SLOT.get(def as usize).copied().unwrap_or(255))),",
    "            None => ModifierListId::NIL,",
    "        }",
    "    }",
  );
  for (const acc of BASE_ACCESSORS) {
    const owner = defs.find(d => d.bases.includes(acc.base))!;
    const fields = acc.fields.map(n => owner.slots.find(s => s.goName === n)!);
    const hasText = fields.some(f => f.slot === "Text");
    out.push(`    // ${acc.fn.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("")}() of nodeData: None where upstream returns nil.`);
    out.push(`    pub fn ${acc.fn}(self, node: NodeId) -> Option<${acc.base}${hasText ? "<'a>" : ""}> {`);
    out.push("        let (def, d) = self.data_any(node)?;");
    out.push(`        let s = ${upperSnake(acc.base)}_SLOTS.get(def as usize)?;`);
    out.push("        if s.first().copied().unwrap_or(255) == 255 {", "            return None;", "        }");
    out.push(`        Some(${acc.base} {`);
    fields.forEach((f, i) => out.push(`            ${f.rust}: d.${READ[f.slot!]}(usize::from(s[${i}])),`));
    out.push("        })", "    }");
  }
  out.push("}", "");

  // The factory.
  let factories = 0;
  let updates = 0;
  out.push("// NodeFactory of upstream: one constructor for a definition and for each of its kind aliases.", "pub trait NodeFactory: NodeSink {");
  for (const d of defs) {
    if (d.handWritten) continue;
    emitFactory(d, d.rust, d.primaryKind, out);
    factories++;
    for (const alias of d.kindAliases) {
      emitFactory(d, snake(alias), alias, out);
      factories++;
    }
  }
  out.push("}", "", "impl<T: NodeSink> NodeFactory for T {}", "");
  out.push("// The Update functions of NodeFactory: the node itself when no member changed.", "pub trait NodeUpdater: NodeUpdate {");
  for (const d of defs) {
    if (d.handWritten || !hasUpdate(d)) continue;
    emitUpdate(d, out);
    updates++;
  }
  out.push("}", "", "impl<T: NodeUpdate> NodeUpdater for T {}", "");

  void LATE;
  void LATE_ORDER;
  const stats = {
    defs: defs.length,
    slots: defs.reduce((n, d) => n + d.slots.length, 0),
    lates: defs.reduce((n, d) => n + d.lates.length, 0),
    factories,
    updates,
    kindsWithTwoDefs: ambiguous,
    kinds: kindNames.length,
  };
  return { text: out.join("\n"), stats };
}

export type { Field };
