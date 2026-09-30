// Generates kind_generated.rs and ast_generated.rs from ast.json, the AST schema of typescript-go (_scripts/ast.json).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type TypeRef = string | string[];
type ListKind = "NodeList" | "ModifierList" | "raw";

interface FieldJson {
  type?: TypeRef;
  list?: ListKind;
  visit?: string;
  optional?: boolean;
  goOnly?: boolean;
  noGo?: boolean;
  noFactory?: boolean;
}

interface MemberJson extends FieldJson {
  name: string;
  inherited?: boolean;
  bitmask?: string;
}

interface BaseJson {
  extends?: string[];
  fields?: Record<string, FieldJson>;
}

interface NodeJson {
  kind?: string | string[];
  extends: string[];
  members?: MemberJson[];
  handWritten?: boolean;
  handWrittenVisitor?: boolean;
  typeParameters?: { name: string; constraint: string }[];
  instantiationAliases?: Record<string, string>;
}

interface Schema {
  kinds: {
    elements: (string | { name?: string })[];
    markers: { name: string; value: string }[];
    aliases?: Record<string, string[] | { range: [string, string] }>;
  };
  bases: Record<string, BaseJson>;
  nodes: {
    definitions: Record<string, NodeJson>;
    aliases: Record<string, string[] | { base: string }>;
    listAliases?: Record<string, string>;
  };
}

type BaseKind = "node" | "list" | "kind" | "primitive";

interface Resolved {
  base: BaseKind;
  primitive?: string;
  kinds: string[];
}

type SlotType =
  | "Node"
  | "NodeList"
  | "ModifierList"
  | "RawNodeList"
  | "Text"
  | "Bool"
  | "Kind"
  | "TokenFlags"
  | "Int"
  | "Any"
  | "FlowNode"
  | "FlowList";

interface Slot {
  goName: string;
  rust: string;
  type: SlotType;
  index: number;
  visit: string;
  bitmask?: string;
}

interface Param {
  rust: string;
  kind: "kind" | "flags" | "slot";
  slot?: Slot;
  bitmask?: string;
}

interface Def {
  name: string;
  rust: string;
  kinds: string[];
  primaryKind: string;
  kindAliases: string[];
  kindParam: boolean;
  kindIsTypeParameter: boolean;
  kindTypes: string[];
  slots: Slot[];
  factorySlots: number;
  lates: string[];
  params: Param[];
  children: number[];
  childrenAlt: number[];
  handWritten: boolean;
  hasText: boolean;
  bases: string[];
}

const PRIMITIVES = new Set(["any", "bool", "boolean", "int", "ModifierFlags", "NodeFlags", "string", "TokenFlags"]);

// The fields that only the binder writes, in the order of their LATE_* bits.
const LATE: Record<string, string> = {
  Symbol: "LATE_SYMBOL",
  LocalSymbol: "LATE_LOCAL_SYMBOL",
  Locals: "LATE_LOCALS",
  NextContainer: "LATE_NEXT_CONTAINER",
  FlowNode: "LATE_FLOW_NODE",
  EndFlowNode: "LATE_END_FLOW_NODE",
  ReturnFlowNode: "LATE_RETURN_FLOW_NODE",
  FallthroughFlowNode: "LATE_FALLTHROUGH_FLOW_NODE",
};
const LATE_ORDER = Object.keys(LATE);

const RUST_TYPE: Record<SlotType, string> = {
  Node: "NodeId",
  NodeList: "NodeListId",
  ModifierList: "ModifierListId",
  RawNodeList: "NodeListId",
  Text: "&'a [u8]",
  Bool: "bool",
  Kind: "Kind",
  TokenFlags: "TokenFlags",
  Int: "i32",
  Any: "u32",
  FlowNode: "FlowNodeId",
  FlowList: "FlowListId",
};

const READ: Record<SlotType, string> = {
  Node: "node",
  NodeList: "list",
  ModifierList: "modifiers",
  RawNodeList: "list",
  Text: "text",
  Bool: "bool",
  Kind: "kind",
  TokenFlags: "token_flags",
  Int: "int",
  Any: "word",
  FlowNode: "flow_node",
  FlowList: "flow_list",
};

// The fields of the binder as the generated structs hold them: the type, and the reader of NodeData.
const LATE_FIELD: Record<string, [string, string]> = {
  Symbol: ["SymbolId", "late_symbol"],
  LocalSymbol: ["SymbolId", "late_symbol"],
  Locals: ["SymbolTableId", "late_table"],
  NextContainer: ["NodeId", "late_node"],
  FlowNode: ["FlowNodeId", "late_flow"],
  EndFlowNode: ["FlowNodeId", "late_flow"],
  ReturnFlowNode: ["FlowNodeId", "late_flow"],
  FallthroughFlowNode: ["FlowNodeId", "late_flow"],
};

const NONE = 255;

// JSDoc is one word, as in upstream's own uncapitalize, and a run of capitals is one word.
function words(name: string): string {
  return name
    .replace(/JSDoc/g, "Jsdoc")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
}

export function snake(name: string): string {
  return words(name).toLowerCase();
}

function upperSnake(name: string): string {
  return words(name).toUpperCase();
}

// `Type` is the one member whose snake_case name is a Rust keyword: upstream's own parameter name is typeNode.
function fieldName(name: string): string {
  const s = snake(name);
  return s === "type" ? "type_node" : s;
}

function flagConst(goName: string): string {
  const match = /^(NodeFlags|TokenFlags)(\w+)$/.exec(goName);
  if (!match) throw new Error(`bitmask ${goName}`);
  return `${match[1]}::${upperSnake(match[2])}`;
}

class Model {
  readonly schema: Schema;
  readonly kindNames: string[];
  readonly defs: Def[];
  private readonly kindAliases = new Map<string, { members: string[]; range?: [string, string] }>();
  private readonly instantiationAliases = new Set<string>();

  constructor(schema: Schema) {
    this.schema = schema;
    this.kindNames = schema.kinds.elements
      .map(element => (typeof element === "string" ? element : element.name))
      .filter((name): name is string => !!name);
    for (const [name, value] of Object.entries(schema.kinds.aliases ?? {})) {
      if (Array.isArray(value)) {
        this.kindAliases.set(name, { members: value });
        continue;
      }
      const first = this.kindNames.indexOf(this.resolveMarker(value.range[0]));
      const last = this.kindNames.indexOf(this.resolveMarker(value.range[1]));
      if (first < 0 || last < 0) throw new Error(`kind alias ${name}: unknown range`);
      this.kindAliases.set(name, { members: this.kindNames.slice(first, last + 1), range: value.range });
    }
    for (const node of Object.values(schema.nodes.definitions)) {
      for (const alias of Object.keys(node.instantiationAliases ?? {})) this.instantiationAliases.add(alias);
    }
    for (const marker of schema.kinds.markers) {
      if (!this.kindNames.includes(this.resolveMarker(marker.name))) throw new Error(`marker ${marker.name}`);
    }
    this.defs = [
      ...Object.entries(schema.nodes.definitions).map(([name, node]) => this.buildDef(name, node)),
      ...flowDefs(),
    ];
  }

  // A marker can name another marker.
  resolveMarker(name: string): string {
    const marker = this.schema.kinds.markers.find(m => m.name === name);
    return marker ? this.resolveMarker(marker.value) : name;
  }

  expandKindAlias(name: string): string[] {
    const alias = this.kindAliases.get(name);
    if (!alias) return [name];
    return alias.members.flatMap(member => (this.kindAliases.has(member) ? this.expandKindAlias(member) : [member]));
  }

  kindGuards(): { name: string; range?: [string, string]; members: string[] }[] {
    return [...this.kindAliases.entries()].map(([name, alias]) => ({
      name,
      range: alias.range,
      members: alias.range ? [] : this.expandKindAlias(name),
    }));
  }

  private resolve(type: TypeRef, node?: NodeJson): Resolved {
    if (Array.isArray(type)) {
      const parts = type.map(part => this.resolve(part, node));
      const bases = new Set(parts.map(part => part.base));
      const kinds = parts.flatMap(part => part.kinds);
      if (bases.size === 1) return { base: parts[0].base, primitive: parts[0].primitive, kinds };
      if (bases.has("list") || bases.has("node")) return { base: "node", kinds };
      return { base: bases.has("kind") ? "kind" : "primitive", kinds };
    }
    const parameter = node?.typeParameters?.find(p => p.name === type);
    if (parameter) {
      if (parameter.constraint === type) return { base: "primitive", primitive: type, kinds: [] };
      return this.resolve(parameter.constraint, node);
    }
    if (this.kindAliases.has(type)) return { base: "kind", kinds: this.expandKindAlias(type) };
    if (type === "Kind") return { base: "kind", kinds: [] };
    if (type.startsWith("SyntaxKind.")) return { base: "kind", kinds: [type.slice("SyntaxKind.".length)] };
    if (type === "Node") return { base: "node", kinds: [] };
    if (PRIMITIVES.has(type)) return { base: "primitive", primitive: type, kinds: [] };
    if (this.schema.nodes.listAliases?.[type]) return { base: "list", kinds: [] };
    if (this.instantiationAliases.has(type)) return { base: "node", kinds: [] };
    if (type in this.schema.nodes.aliases) return { base: "node", kinds: [] };
    if (type in this.schema.nodes.definitions || type in this.schema.bases) return { base: "node", kinds: [] };
    return { base: "primitive", primitive: type, kinds: [] };
  }

  // The field of a base that a member marked `inherited` takes its type from: the first in the order of `extends`.
  private inheritedField(extendsKeys: string[], name: string): FieldJson | undefined {
    for (const key of extendsKeys) {
      const base = this.schema.bases[key];
      if (!base) continue;
      const direct = base.fields?.[name];
      if (direct) return direct;
      const inherited = this.inheritedField(base.extends ?? [], name);
      if (inherited) return inherited;
    }
    return undefined;
  }

  // Every field of the bases of a node, a base before the fields it adds, each base once.
  private baseFields(key: string, seen: Set<string>, out: { base: string; name: string; field: FieldJson }[]): void {
    const base = this.schema.bases[key];
    if (!base || seen.has(key)) return;
    seen.add(key);
    for (const ext of base.extends ?? []) this.baseFields(ext, seen, out);
    for (const [name, field] of Object.entries(base.fields ?? {})) out.push({ base: key, name, field });
  }

  private slotType(where: string, type: TypeRef | undefined, list: ListKind | undefined, node?: NodeJson) {
    if (type === undefined) throw new Error(`${where}: no type`);
    const declared = this.resolve(type, node);
    if (list === "raw") return { slot: (declared.base === "node" ? "RawNodeList" : "Text") as SlotType, declared };
    if (list) return { slot: (list === "ModifierList" ? "ModifierList" : "NodeList") as SlotType, declared };
    switch (declared.base) {
      case "node":
        return { slot: "Node" as SlotType, declared };
      case "list":
        return { slot: "NodeList" as SlotType, declared };
      case "kind":
        return { slot: "Kind" as SlotType, declared };
    }
    switch (declared.primitive) {
      case "NodeFlags":
        return { flags: true, declared };
      case "TokenFlags":
        return { slot: "TokenFlags" as SlotType, declared };
      case "bool":
      case "boolean":
        return { slot: "Bool" as SlotType, declared };
      case "string":
        return { slot: "Text" as SlotType, declared };
      case "any":
        return { slot: "Any" as SlotType, declared };
      case "int":
        return { slot: "Int" as SlotType, declared };
    }
    throw new Error(`${where}: no slot for ${JSON.stringify(type)}`);
  }

  private buildDef(name: string, node: NodeJson): Def {
    const members = (node.members ?? []).map(json => {
      const field = json.inherited ? this.inheritedField(node.extends, json.name) : undefined;
      const type = !json.inherited || json.type !== undefined ? json.type : field?.type;
      const list = json.inherited ? field?.list : json.list;
      const isKindName = json.name === "Kind" || json.name === "kind";
      const declared = type === undefined ? undefined : this.resolve(type, node);
      return {
        json,
        type,
        list,
        visit: json.visit ?? field?.visit,
        goOnly: json.goOnly ?? false,
        noFactory: (json.goOnly ?? false) || (json.noFactory ?? false),
        isKindParam: isKindName && declared?.base === "kind",
        isKindMember: isKindName,
        declared,
      };
    });
    const kindMember = members.find(m => m.isKindMember);
    const primaryKind = Array.isArray(node.kind) ? node.kind[0] : (node.kind ?? name);
    const kindAliases = Array.isArray(node.kind) ? node.kind.slice(1) : [];
    const kindTypes = [...new Set(kindMember?.declared?.kinds ?? [])];
    if (kindTypes.length === 0) kindTypes.push(primaryKind);
    const parameter = kindMember ? node.typeParameters?.find(p => p.name === kindMember.type) : undefined;

    const slots: Slot[] = [];
    const lates: string[] = [];
    const params: Param[] = [];
    const children: number[] = [];
    const taken = new Set<string>();
    const addLate = (goName: string) => {
      if (!(goName in LATE)) throw new Error(`${name}.${goName}: a goOnly field that the binder does not write`);
      if (!lates.includes(goName)) lates.push(goName);
    };
    const addSlot = (goName: string, type: SlotType, visit: string, bitmask?: string): Slot => {
      const slot = { goName, rust: fieldName(goName), type, index: slots.length, visit, bitmask };
      if (slots.some(other => other.rust === slot.rust)) throw new Error(`${name}: two members named ${slot.rust}`);
      slots.push(slot);
      return slot;
    };

    if (members.some(m => m.isKindParam && !m.noFactory)) params.push({ rust: "kind", kind: "kind" });
    for (const m of members) {
      if (m.noFactory || m.isKindParam) continue;
      taken.add(m.json.name);
      const typed = this.slotType(`${name}.${m.json.name}`, m.type, m.list, node);
      if (typed.flags) {
        params.push({ rust: fieldName(m.json.name), kind: "flags", bitmask: m.json.bitmask });
        continue;
      }
      const isChild = typed.slot === "Node" || typed.slot === "NodeList" || typed.slot === "ModifierList";
      let visit = "None";
      if (isChild || typed.slot === "RawNodeList") {
        if (typed.slot === "RawNodeList") visit = "RawNodes";
        else if (m.visit) visit = m.visit.charAt(0).toUpperCase() + m.visit.slice(1);
        else if (typed.slot === "ModifierList") visit = "Modifiers";
        else if (typed.slot === "NodeList") visit = "Nodes";
        else visit = "Node";
      }
      // ast.go writes the visitor of SourceFile by hand: the end of file token goes through visitToken.
      if (name === "SourceFile" && m.json.name === "EndOfFileToken") visit = "Token";
      const slot = addSlot(m.json.name, typed.slot!, visit, m.json.bitmask);
      params.push({ rust: slot.rust, kind: "slot", slot, bitmask: m.json.bitmask });
      if (visit !== "None") children.push(slot.index);
    }
    const factorySlots = slots.length;
    for (const m of members) {
      if (taken.has(m.json.name) || m.isKindParam || m.json.noGo || m.json.inherited) continue;
      taken.add(m.json.name);
      if (!m.goOnly) throw new Error(`${name}.${m.json.name}: an own member outside the factory`);
      addLate(m.json.name);
    }
    const inherited: { base: string; name: string; field: FieldJson }[] = [];
    const bases = new Set<string>();
    for (const ext of node.extends) this.baseFields(ext, bases, inherited);
    for (const { base, name: fieldGoName, field } of inherited) {
      if (field.noGo) continue;
      if (field.goOnly) {
        if (fieldGoName !== "facts") addLate(fieldGoName);
        continue;
      }
      if (taken.has(fieldGoName) || (base === "NodeBase" && fieldGoName === "Flags")) continue;
      taken.add(fieldGoName);
      const typed = this.slotType(`${name}.${fieldGoName} of ${base}`, field.type, field.list);
      if (!typed.slot) throw new Error(`${name}.${fieldGoName} of ${base}: flags`);
      addSlot(fieldGoName, typed.slot, "None");
    }
    lates.sort((a, b) => LATE_ORDER.indexOf(a) - LATE_ORDER.indexOf(b));

    let childrenAlt: number[] = [];
    if (node.handWrittenVisitor) {
      if (name !== "JSDocParameterOrPropertyTag") throw new Error(`${name}: a hand-written visitor`);
      const slot = (goName: string) => slots.findIndex(s => s.goName === goName);
      // forEachChild_JSDocParameterOrPropertyTag of ast.go: the name comes before the type when IsNameFirst is set.
      childrenAlt = [slot("TagName"), slot("name"), slot("TypeExpression"), slot("Comment")];
      children.splice(0, children.length, slot("TagName"), slot("TypeExpression"), slot("name"), slot("Comment"));
      if (children.includes(-1) || slot("IsNameFirst") < 0) throw new Error(`${name}: members changed`);
    }
    return {
      name,
      rust: snake(name),
      kinds: [...kindTypes, ...kindAliases],
      primaryKind,
      kindAliases,
      kindParam: params.some(p => p.kind === "kind"),
      kindIsTypeParameter: !!parameter,
      kindTypes,
      slots,
      factorySlots,
      lates,
      params,
      children,
      childrenAlt,
      handWritten: !!node.handWritten,
      hasText: slots.some(s => s.type === "Text"),
      bases: [...bases],
    };
  }
}

// The two nodes that flow.go writes by hand. Their kind is Unknown and no kind maps to them.
function flowDefs(): Def[] {
  const make = (name: string, fields: [string, SlotType][]): Def => ({
    name,
    rust: snake(name),
    kinds: [],
    primaryKind: "Unknown",
    kindAliases: [],
    kindParam: false,
    kindIsTypeParameter: false,
    kindTypes: [],
    slots: fields.map(([goName, type], index) => ({ goName, rust: fieldName(goName), type, index, visit: "None" })),
    factorySlots: 0,
    lates: [],
    params: [],
    children: [],
    childrenAlt: [],
    handWritten: true,
    hasText: false,
    bases: ["NodeBase"],
  });
  return [
    make("FlowSwitchClauseData", [
      ["SwitchStatement", "Node"],
      ["ClauseStart", "Int"],
      ["ClauseEnd", "Int"],
    ]),
    make("FlowReduceLabelData", [
      ["Target", "FlowNode"],
      ["Antecedents", "FlowList"],
    ]),
  ];
}

function header(part: string): string {
  return `// Generated by generate.ts from ast.json (${part} of typescript-go 89d5d5b). Do not edit.`;
}

// Lines of at most 100 columns, each item followed by a comma.
function wrap(items: string[], indent: string): string[] {
  const lines: string[] = [];
  let line = indent;
  for (const item of items) {
    const piece = item + ",";
    if (line.length > indent.length && line.length + 1 + piece.length > 100) {
      lines.push(line);
      line = indent;
    }
    line += (line.length > indent.length ? " " : "") + piece;
  }
  if (line.length > indent.length) lines.push(line);
  return lines;
}

function kindSet(kinds: string[], indent: string): string[] {
  const lines: string[] = [];
  let line = indent;
  kinds.forEach((kind, i) => {
    const piece = (i === 0 ? "" : "| ") + `Kind::${kind}`;
    if (line.length > indent.length && line.length + 1 + piece.length > 100) {
      lines.push(line);
      line = indent;
    }
    line += (line.length > indent.length ? " " : "") + piece;
  });
  lines.push(line);
  return lines;
}

function generateKind(model: Model): string {
  const names = [...model.kindNames, "Count"];
  const out: string[] = [header("the kinds"), ""];
  out.push(
    "#[repr(u16)]",
    "#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Default)]",
    "pub enum Kind {",
  );
  names.forEach((name, i) => out.push(...(i === 0 ? ["    #[default]"] : []), `    ${name},`));
  out.push("}", "");
  out.push(`pub const KIND_COUNT: usize = ${model.kindNames.length};`, "");
  out.push("#[rustfmt::skip]", `static KINDS: [Kind; KIND_COUNT + 1] = [`);
  out.push(
    ...wrap(
      names.map(name => `Kind::${name}`),
      "    ",
    ),
  );
  out.push("];", "");
  out.push("#[rustfmt::skip]", `static KIND_STRINGS: [&str; KIND_COUNT + 1] = [`);
  out.push(
    ...wrap(
      names.map(name => `"Kind${name}"`),
      "    ",
    ),
  );
  out.push("];", "");
  const sorted = [...model.kindNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  out.push("#[rustfmt::skip]", `static KINDS_BY_NAME: [(&str, Kind); KIND_COUNT] = [`);
  out.push(
    ...wrap(
      sorted.map(name => `("${name}", Kind::${name})`),
      "    ",
    ),
  );
  out.push("];", "");
  out.push("impl Kind {");
  for (const marker of model.schema.kinds.markers) {
    out.push(`    pub const ${upperSnake(marker.name)}: Kind = Kind::${model.resolveMarker(marker.name)};`);
  }
  out.push(
    "",
    "    // A number that is no kind is Unknown.",
    "    #[inline]",
    "    pub fn from_u16(value: u16) -> Kind {",
    "        KINDS.get(usize::from(value)).copied().unwrap_or(Kind::Unknown)",
    "    }",
    "",
    "    // Kind.String() of kind_stringer_generated.go: the name of the constant.",
    "    pub fn string(self) -> &'static str {",
    '        KIND_STRINGS.get(self as usize).copied().unwrap_or("KindUnknown")',
    "    }",
    "",
    "    // The name of the constant without its prefix, as a producer that reads a dump spells a kind.",
    "    pub fn name(self) -> &'static str {",
    '        self.string().get(4..).unwrap_or("Unknown")',
    "    }",
    "",
    "    pub fn from_name(name: &[u8]) -> Option<Kind> {",
    "        let at = KINDS_BY_NAME.binary_search_by(|entry| entry.0.as_bytes().cmp(name)).ok()?;",
    "        KINDS_BY_NAME.get(at).map(|entry| entry.1)",
    "    }",
    "}",
    "",
  );
  for (const guard of model.kindGuards()) out.push(`pub type ${guard.name} = Kind;`);
  out.push("");
  for (const guard of model.kindGuards()) {
    const fn = snake(`Is${guard.name.replace("Syntax", "")}`);
    // utilities.go writes IsJSDocKind by hand with another meaning.
    if (fn === "is_jsdoc_kind") continue;
    if (guard.range) {
      const [first, last] = guard.range.map(marker => `Kind::${model.resolveMarker(marker)}`);
      out.push(`pub fn ${fn}(kind: Kind) -> bool {`, `    kind >= ${first} && kind <= ${last}`, "}", "");
    } else {
      out.push("#[rustfmt::skip]", `pub fn ${fn}(kind: Kind) -> bool {`, "    matches!(", "        kind,");
      out.push(...kindSet(guard.members, "        "), "    )", "}", "");
    }
  }
  return out.join("\n").trimEnd() + "\n";
}

function paramList(params: Param[]): string[] {
  return params.map(p => {
    if (p.kind === "kind") return "kind: Kind";
    if (p.kind === "flags") return `${p.rust}: NodeFlags`;
    return `${p.rust}: ${RUST_TYPE[p.slot!.type].replace("&'a ", "&")}`;
  });
}

function slotValue(p: Param): string {
  const slot = p.slot!;
  switch (slot.type) {
    case "Text":
      return `self.text_slot(${p.rust})`;
    case "Bool":
      return `u32::from(${p.rust})`;
    case "Kind":
      return `${p.rust} as u32`;
    case "TokenFlags":
      return p.bitmask ? `(${p.rust} & ${flagConst(p.bitmask)}).bits() as u32` : `${p.rust}.bits() as u32`;
    case "Int":
      return `${p.rust} as u32`;
    case "Any":
      return p.rust;
    default:
      return `${p.rust}.0`;
  }
}

// The members that a constructor sets, as the words of the leading slots of the definition.
function emitSlots(def: Def, params: Param[], out: string[]): string {
  if (def.factorySlots === 0) return "&[]";
  const set = params.filter(p => p.kind === "slot");
  out.push(`        let ${set.length > 0 ? "mut " : ""}s = [0u32; ${def.factorySlots}];`);
  for (const p of set) out.push(`        s[${p.slot!.index}] = ${slotValue(p)};`);
  return "&s";
}

function emitNew(def: Def, fn: string, kind: string, out: string[]): void {
  out.push(`    fn new_${fn}(&mut self, ${paramList(def.params).join(", ")}) -> NodeId {`);
  const slots = emitSlots(def, def.params, out);
  if (def.hasText) out.push("        self.count_text();");
  const kindArg = def.kindParam ? "kind" : `Kind::${kind}`;
  const flags = def.params.filter(p => p.kind === "flags");
  if (flags.length > 1) throw new Error(`${def.name}: two flags members`);
  // ast_generated.go: a masked flags member is or-ed into the flags of the new node, another one replaces them.
  let flagsArg = "NodeFlags::NONE";
  if (flags.length === 1)
    flagsArg = flags[0].bitmask ? `${flags[0].rust} & ${flagConst(flags[0].bitmask)}` : flags[0].rust;
  out.push(`        self.alloc_node(Def::${def.name}, ${kindArg}, ${flagsArg}, ${slots})`, "    }", "");
}

function hasUpdate(def: Def): boolean {
  return def.children.length > 0;
}

function emitUpdate(def: Def, out: string[]): void {
  const params = def.params.filter(p => p.kind !== "kind");
  out.push(`    fn update_${def.rust}(&mut self, node: NodeId, ${paramList(params).join(", ")}) -> NodeId {`);
  const slots = emitSlots(def, params, out);
  const flags = params.filter(p => p.kind === "flags");
  const flagsArg = flags.length > 0 ? `Some(${flags[0].rust})` : "None";
  out.push(`        self.update_node(node, Def::${def.name}, ${flagsArg}, ${slots})`, "    }", "");
}

function emitStruct(def: Def, out: string[]): void {
  const lifetime = def.hasText ? "<'a>" : "";
  out.push("#[derive(Clone, Copy, Default, Debug)]", `pub struct ${def.name}${lifetime} {`);
  for (const slot of def.slots) out.push(`    pub ${slot.rust}: ${RUST_TYPE[slot.type]},`);
  for (const late of def.lates) {
    if (def.slots.some(slot => slot.rust === snake(late)))
      throw new Error(`${def.name}: two fields named ${snake(late)}`);
    out.push(`    pub ${snake(late)}: ${LATE_FIELD[late][0]},`);
  }
  out.push("}", "");
}

function emitPredicates(def: Def, seen: Set<string>, out: string[]): void {
  if (def.kinds.length === 0) return;
  const one = (name: string, kinds: string[]) => {
    const fn = `is_${snake(name)}`;
    if (seen.has(fn)) throw new Error(`two predicates named ${fn}`);
    seen.add(fn);
    if (kinds.length === 1) {
      out.push(`pub fn ${fn}(a: Ast<'_>, node: NodeId) -> bool {`, `    a.kind(node) == Kind::${kinds[0]}`, "}", "");
      return;
    }
    out.push(
      "#[rustfmt::skip]",
      `pub fn ${fn}(a: Ast<'_>, node: NodeId) -> bool {`,
      "    matches!(",
      "        a.kind(node),",
    );
    out.push(...kindSet(kinds, "        "), "    )", "}", "");
  };
  if (def.kindIsTypeParameter) {
    one(def.name, def.kindTypes);
  } else if (def.kindTypes.length > 1) {
    for (const kind of def.kindTypes) one(kind, [kind]);
  } else {
    one(def.name, [def.primaryKind]);
    for (const alias of def.kindAliases) one(alias, [alias]);
  }
}

function emitCast(def: Def, out: string[]): void {
  const lifetime = def.hasText ? "<'a>" : "";
  out.push(`    pub fn as_${def.rust}(self, node: NodeId) -> ${def.name}${lifetime} {`);
  if (def.slots.length + def.lates.length === 0) {
    out.push(`        self.check_def(node, Def::${def.name});`, `        ${def.name} {}`, "    }", "");
    return;
  }
  out.push(`        let Some(d) = self.data(node, Def::${def.name}) else {`);
  out.push(`            return ${def.name}::default();`, "        };", `        ${def.name} {`);
  for (const slot of def.slots) out.push(`            ${slot.rust}: d.${READ[slot.type]}(${slot.index}),`);
  for (const late of def.lates) out.push(`            ${snake(late)}: d.${LATE_FIELD[late][1]}(${LATE[late]}),`);
  out.push("        }", "    }", "");
}

interface BaseAccessor {
  base: string;
  fn: string;
  fields: string[];
}

// The bases that upstream reaches through a method of nodeData, with the fields that the method's result gives.
const BASE_ACCESSORS: BaseAccessor[] = [
  {
    base: "FunctionLikeBase",
    fn: "function_like_data",
    fields: ["TypeParameters", "Parameters", "Type", "FullSignature"],
  },
  {
    base: "ClassLikeBase",
    fn: "class_like_data",
    fields: ["modifiers", "name", "TypeParameters", "HeritageClauses", "Members"],
  },
  { base: "BodyBase", fn: "body_data", fields: ["AsteriskToken", "Body"] },
  { base: "LiteralLikeNodeBase", fn: "literal_like_data", fields: ["Text", "TokenFlags"] },
  {
    base: "TemplateLiteralLikeNodeBase",
    fn: "template_literal_like_data",
    fields: ["Text", "TokenFlags", "RawText", "TemplateFlags"],
  },
];

function generateAst(model: Model): string {
  const defs = model.defs;
  const out: string[] = [header("the node definitions"), ""];
  out.push(
    "use crate::ast::factory::{NodeSink, NodeUpdate};",
    "use crate::ast::ids::{",
    "    FlowListId, FlowNodeId, ModifierListId, NodeId, NodeListId, SymbolId, SymbolTableId,",
    "};",
    "use crate::ast::kind_generated::{KIND_COUNT, Kind};",
    "use crate::ast::layout::{",
    "    DefInfo, LATE_END_FLOW_NODE, LATE_FALLTHROUGH_FLOW_NODE, LATE_FLOW_NODE, LATE_LOCAL_SYMBOL, LATE_LOCALS,",
    "    LATE_NEXT_CONTAINER, LATE_RETURN_FLOW_NODE, LATE_SYMBOL, SlotInfo, SlotType, VisitTag,",
    "};",
    "use crate::ast::nodeflags::NodeFlags;",
    "use crate::ast::reader::Ast;",
    "use crate::ast::tokenflags::TokenFlags;",
    "",
  );

  out.push("#[repr(u8)]", "#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]", "pub enum Def {");
  out.push("    #[default]", "    None,", ...defs.map(def => `    ${def.name},`), "}", "");
  out.push(`pub const DEF_COUNT: usize = ${defs.length + 1};`, "");
  out.push("// The largest number of slots of one definition.");
  out.push(`pub const MAX_SLOTS: usize = ${Math.max(...defs.map(def => def.slots.length))};`, "");

  out.push("#[rustfmt::skip]", "static DEFS: [Def; DEF_COUNT] = [");
  out.push(...wrap(["Def::None", ...defs.map(def => `Def::${def.name}`)], "    "), "];", "");

  const empty = `DefInfo { name: "", slots: &[], factory_slots: 0, children: &[], children_alt: &[], late: 0 }`;
  out.push("#[rustfmt::skip]", "static DEF_INFOS: [DefInfo; DEF_COUNT] = [", `    ${empty},`);
  for (const def of defs) {
    const slots = def.slots
      .map(s => {
        const mask = s.bitmask ? `${flagConst(s.bitmask)}.bits() as u32` : "u32::MAX";
        return `SlotInfo { name: "${s.goName}", ty: SlotType::${s.type}, visit: VisitTag::${s.visit}, mask: ${mask} }`;
      })
      .join(", ");
    const late = def.lates.length > 0 ? def.lates.map(name => LATE[name]).join(" | ") : "0";
    out.push(
      `    DefInfo { name: "${def.name}", slots: &[${slots}], ` +
        `factory_slots: ${def.factorySlots}, children: &[${def.children.join(", ")}], ` +
        `children_alt: &[${def.childrenAlt.join(", ")}], late: ${late} },`,
    );
  }
  out.push("];", "");

  const byKind = new Map<string, string[]>();
  for (const def of defs) for (const kind of def.kinds) byKind.set(kind, [...(byKind.get(kind) ?? []), def.name]);
  out.push("#[rustfmt::skip]", "static KIND_DEFS: [(Def, Def); KIND_COUNT + 1] = [");
  const pairs = model.kindNames.map(kind => {
    const list = byKind.get(kind) ?? [];
    if (list.length > 2 || (list.length === 2 && !list.includes("Token"))) throw new Error(`kind ${kind}: ${list}`);
    const main = list.find(name => name !== "Token") ?? list[0] ?? "None";
    return `(Def::${main}, Def::${list.length > 1 ? "Token" : "None"})`;
  });
  out.push(...wrap([...pairs, "(Def::None, Def::None)"], "    "), "];", "");

  out.push(
    "impl Def {",
    "    #[inline]",
    "    pub fn from_u8(value: u8) -> Def {",
    "        DEFS.get(usize::from(value)).copied().unwrap_or(Def::None)",
    "    }",
    "",
    "    #[inline]",
    "    pub fn info(self) -> &'static DefInfo {",
    "        match DEF_INFOS.get(self as usize) {",
    "            Some(info) => info,",
    "            None => &DEF_INFOS[0],",
    "        }",
    "    }",
    "",
    "    // The definitions of a kind: the node definition, then Token when the kind is a token kind as well.",
    "    pub fn of_kind(kind: Kind) -> (Def, Def) {",
    "        KIND_DEFS.get(kind as usize).copied().unwrap_or((Def::None, Def::None))",
    "    }",
    "",
    "    // The definition with this name in ast.json.",
    "    pub fn from_name(name: &[u8]) -> Def {",
    "        DEFS.iter().copied().find(|def| def.info().name.as_bytes() == name).unwrap_or(Def::None)",
    "    }",
    "}",
    "",
  );

  const slotTable = (table: string, goName: string) => {
    const cells = defs.map(def => String(def.slots.find(s => s.goName === goName)?.index ?? NONE));
    out.push("#[rustfmt::skip]", `pub(crate) static ${table}: [u8; DEF_COUNT] = [`);
    out.push(...wrap([String(NONE), ...cells], "    "), "];", "");
  };
  slotTable("NAME_SLOT", "name");
  slotTable("MODIFIERS_SLOT", "modifiers");

  for (const accessor of BASE_ACCESSORS) {
    const owner = defs.find(def => def.bases.includes(accessor.base));
    if (!owner) throw new Error(`${accessor.base}: no node`);
    const fields = accessor.fields.map(goName => {
      const slot = owner.slots.find(s => s.goName === goName);
      if (!slot) throw new Error(`${accessor.base}.${goName}: no slot in ${owner.name}`);
      return slot;
    });
    const lifetime = fields.some(f => f.type === "Text") ? "<'a>" : "";
    out.push("#[derive(Clone, Copy, Default, Debug)]", `pub struct ${accessor.base}${lifetime} {`);
    for (const f of fields) out.push(`    pub ${f.rust}: ${RUST_TYPE[f.type]},`);
    out.push("}", "");
    const rows = defs.map(def => {
      if (!def.bases.includes(accessor.base)) return `[${NONE}; ${fields.length}]`;
      const cells = fields.map(f => {
        const own = def.slots.find(s => s.goName === f.goName);
        if (!own || own.type !== f.type) throw new Error(`${def.name}: base ${accessor.base} without ${f.goName}`);
        return own.index;
      });
      return `[${cells.join(", ")}]`;
    });
    const table = `${upperSnake(accessor.base)}_SLOTS`;
    out.push("#[rustfmt::skip]", `pub(crate) static ${table}: [[u8; ${fields.length}]; DEF_COUNT] = [`);
    out.push(...wrap([`[${NONE}; ${fields.length}]`, ...rows], "    "), "];", "");
  }

  // ast.go writes SourceFile by hand: its struct and its cast are beside the file that holds it.
  const predicates = new Set<string>();
  for (const def of defs) {
    if (def.name !== "SourceFile") emitStruct(def, out);
    emitPredicates(def, predicates, out);
  }

  out.push("impl<'a> Ast<'a> {");
  for (const def of defs) if (def.name !== "SourceFile") emitCast(def, out);
  for (const accessor of BASE_ACCESSORS) {
    const owner = defs.find(def => def.bases.includes(accessor.base))!;
    const fields = accessor.fields.map(goName => owner.slots.find(s => s.goName === goName)!);
    const lifetime = fields.some(f => f.type === "Text") ? "<'a>" : "";
    const goMethod = accessor.fn.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase());
    out.push(`    // ${goMethod}() of nodeData: None where upstream returns nil.`);
    out.push(`    pub fn ${accessor.fn}(self, node: NodeId) -> Option<${accessor.base}${lifetime}> {`);
    out.push(`        let (d, at) = self.base_data(node, &${upperSnake(accessor.base)}_SLOTS)?;`);
    out.push(`        Some(${accessor.base} {`);
    fields.forEach((f, i) => out.push(`            ${f.rust}: d.${READ[f.type]}(usize::from(at[${i}])),`));
    out.push("        })", "    }", "");
  }
  out.pop();
  out.push("}", "");

  out.push("// The constructors of upstream's NodeFactory: one for a definition and for each of its kind aliases.");
  out.push("pub trait NodeFactory: NodeSink {");
  for (const def of defs) {
    if (def.handWritten) continue;
    emitNew(def, def.rust, def.primaryKind, out);
    for (const alias of def.kindAliases) emitNew(def, snake(alias), alias, out);
  }
  out.push("    // NodeFactory.NewModifier of ast.go", "    fn new_modifier(&mut self, kind: Kind) -> NodeId {");
  out.push("        self.new_token(kind)", "    }", "}", "");
  out.push("impl<T: NodeSink + ?Sized> NodeFactory for T {}", "");

  out.push("// The Update functions of upstream's NodeFactory.");
  out.push("pub trait NodeUpdater: NodeUpdate {");
  for (const def of defs) {
    if (def.handWritten) continue;
    if (hasUpdate(def)) emitUpdate(def, out);
  }
  out.pop();
  out.push("}", "");
  out.push("impl<T: NodeUpdate + ?Sized> NodeUpdater for T {}");
  return out.join("\n") + "\n";
}

export function generate(astJson: string): { kind: string; ast: string } {
  const model = new Model(JSON.parse(astJson) as Schema);
  return { kind: generateKind(model), ast: generateAst(model) };
}

// What rustfmt may change: whitespace, and a comma before a closing bracket.
export function normalize(rust: string): string {
  return rust.replace(/\s+/g, "").replace(/,([)\]}])/g, "$1");
}

if (import.meta.main) {
  const dir = import.meta.dir;
  const check = process.argv.includes("--check");
  const generated = generate(readFileSync(join(dir, "ast.json"), "utf8"));
  for (const [file, raw] of [
    ["kind_generated.rs", generated.kind],
    ["ast_generated.rs", generated.ast],
  ]) {
    const path = join(dir, file);
    if (check) {
      if (normalize(readFileSync(path, "utf8")) !== normalize(raw)) {
        console.error(`${file} is not what generate.ts writes from ast.json: run bun ${join(dir, "generate.ts")}`);
        process.exit(1);
      }
      continue;
    }
    const formatted = Bun.spawnSync(["rustfmt", "--edition", "2024", "--emit", "stdout"], { stdin: Buffer.from(raw) });
    const text = formatted.stdout.toString();
    if (formatted.exitCode !== 0 || normalize(text) !== normalize(raw)) {
      console.error(`rustfmt did not keep ${file} as generated\n${formatted.stderr.toString()}`);
      process.exit(1);
    }
    writeFileSync(path, text);
    console.log(`wrote ${file} (${text.split("\n").length - 1} lines)`);
  }
}
