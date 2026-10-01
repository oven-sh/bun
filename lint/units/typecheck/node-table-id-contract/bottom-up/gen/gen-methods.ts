// Ports the hand-written methods of Node (internal/ast/ast.go, `func (n *Node) AsNode` to the casts before nodeData).
// A method whose body is a switch over the kind is translated. The others are named in a table with their Rust counterpart.
import { readFileSync } from "node:fs";
import type { Def } from "./model.ts";
import { allDefs } from "./model.ts";
import { field, GENERATED, snake } from "./names.ts";

const AST_GO = "/workspace/ref/typescript-go/internal/ast/ast.go";

const RETURN_TYPE: Record<string, { rust: string; nil: string; slots: string[] }> = {
  "*Node": { rust: "NodeId", nil: "NodeId::NIL", slots: ["Node"] },
  "*Expression": { rust: "NodeId", nil: "NodeId::NIL", slots: ["Node"] },
  "*Statement": { rust: "NodeId", nil: "NodeId::NIL", slots: ["Node"] },
  "*TokenNode": { rust: "NodeId", nil: "NodeId::NIL", slots: ["Node"] },
  "*NodeList": { rust: "NodeListId", nil: "NodeListId::NIL", slots: ["NodeList", "RawNodeList"] },
  string: { rust: "Text<'a>", nil: 'b""', slots: ["Text"] },
  bool: { rust: "bool", nil: "false", slots: ["Bool"] },
};

// Methods that are not a switch over the kind: where their port is.
const ELSEWHERE: Record<string, string> = {
  AsNode: "none: a NodeId is the node",
  Pos: "Ast::pos (ast/reader.rs)",
  End: "Ast::end (ast/reader.rs)",
  IterChildren: "Ast::iter_children (ast/reader.rs)",
  Clone: "Factory::clone_node (ast/factory.rs)",
  VisitEachChild: "DefInfo::children with VisitTag and Factory::update_node; the NodeVisitor itself is ported with ast/visitor.go",
  Name: "Ast::name (ast_generated.rs, table NAME_SLOT)",
  Modifiers: "Ast::modifiers (ast_generated.rs, table MODIFIERS_SLOT)",
  FlowNodeData: "Ast::has_flow_node_data, Ast::flow_node, Ast::set_flow_node (ast/reader.rs)",
  DeclarationData: "Ast::has_declaration_data, Ast::symbol, Ast::set_symbol (ast/reader.rs)",
  ExportableData: "Ast::has_exportable_data, Ast::local_symbol, Ast::set_local_symbol (ast/reader.rs)",
  LocalsContainerData: "Ast::has_locals_container_data, Ast::locals, Ast::next_container and their setters (ast/reader.rs)",
  FunctionLikeData: "Ast::function_like_data (ast_generated.rs)",
  ParameterList: "Ast::parameter_list (ast/reader.rs)",
  Parameters: "Ast::parameters (ast/reader.rs)",
  ClassLikeData: "Ast::class_like_data (ast_generated.rs)",
  BodyData: "Ast::body_data, Ast::end_flow_node (ast_generated.rs, ast/reader.rs)",
  SubtreeFacts: "not ported: subtree facts serve the transformers",
  propagateSubtreeFacts: "not ported: subtree facts serve the transformers",
  LiteralLikeData: "Ast::literal_like_data (ast_generated.rs)",
  TemplateLiteralLikeData: "Ast::template_literal_like_data (ast_generated.rs)",
  KindString: "Kind::name (kind_generated.rs)",
  KindValue: "Kind as u16",
  Decorators: "Ast::decorators (ast/reader.rs)",
  AsMutable: "none: the setters are methods of FileBuilder; a node of an open store takes Ast::set_slot",
  SetModifiers: "FileBuilder::set_modifiers",
  Symbol: "Ast::symbol (ast/reader.rs)",
  LocalSymbol: "Ast::local_symbol (ast/reader.rs)",
  Locals: "Ast::locals (ast/reader.rs)",
  Body: "Ast::body (ast/reader.rs)",
  Text: "Ast::text (ast/reader.rs): the prototype returns the text slot of a node; MetaProperty and JsxNamespacedName, which build a string, are left to the port",
  ModifierFlags: "Ast::modifier_flags (ast/reader.rs)",
  ModifierNodes: "Ast::modifier_nodes (ast/reader.rs)",
  PropertyNameOrName: "Ast::property_name_or_name (ast/reader.rs)",
  IsTypeOnly: "Ast::is_type_only (ast/reader.rs): one case compares a kind",
  Contains: "Ast::contains (ast/reader.rs)",
  AsFlowSwitchClauseData: "Ast::as_flow_switch_clause_data (ast_generated.rs)",
  AsFlowReduceLabelData: "Ast::as_flow_reduce_label_data (ast_generated.rs)",
};

interface GoFunc {
  receiver: string;
  name: string;
  params: string;
  ret: string;
  line: number;
  body: string[];
}

function readFuncs(): GoFunc[] {
  const lines = readFileSync(AST_GO, "utf8").split("\n");
  const first = lines.findIndex(l => l.startsWith("func (n *Node) AsNode()"));
  const last = lines.findIndex(l => l.startsWith("type nodeData interface"));
  const out: GoFunc[] = [];
  for (let i = first; i < last; i++) {
    const m = /^func \((\w+) \*(Node|MutableNode)\) (\w+)\(([^)]*)\)\s*([^{]*?)\s*\{(.*)$/.exec(lines[i]);
    if (!m) continue;
    const f: GoFunc = { receiver: m[2], name: m[3], params: m[4], ret: m[5], line: i + 1, body: [] };
    if (!m[6].trim().endsWith("}")) {
      for (i++; i < last && lines[i] !== "}"; i++) f.body.push(lines[i]);
    } else {
      f.body.push(m[6].trim().replace(/\}$/, "").trim());
    }
    out.push(f);
  }
  return out;
}

interface Switch {
  arms: { kinds: string[]; body: string[] }[];
  defaultBody: string[] | undefined;
  tail: string[];
}

function parseSwitch(body: string[]): Switch | undefined {
  const start = body.findIndex(l => l.trim() === "switch n.Kind {" || l.trim() === "switch m.Kind {");
  if (start < 0) return undefined;
  if (body.slice(0, start).some(l => l.trim() !== "" && l.trim() !== "n := (*Node)(m)")) return undefined;
  const arms: Switch["arms"] = [];
  let defaultBody: string[] | undefined;
  let current: string[] | undefined;
  let i = start + 1;
  for (; i < body.length; i++) {
    const line = body[i];
    if (line === "\t}") break;
    const c = /^\tcase (.*):$/.exec(line);
    if (c) {
      current = [];
      arms.push({ kinds: c[1].split(",").map(k => k.trim().replace(/^Kind/, "")), body: current });
      continue;
    }
    if (line === "\tdefault:") {
      current = [];
      defaultBody = current;
      continue;
    }
    current?.push(line.trim());
  }
  return { arms, defaultBody, tail: body.slice(i + 1).map(l => l.trim()).filter(l => l !== "") };
}

export function generateMethods(): { text: string; report: string[] } {
  const defs = new Map<string, Def>(allDefs().map(d => [d.name, d]));
  const funcs = readFuncs();
  const out: string[] = [GENERATED("gen/gen-methods.ts", "internal/ast/ast.go (the methods of Node)"), ""];
  out.push(
    "use crate::ast::ast_generated::Def;",
    "use crate::ast::kind_generated::Kind;",
    "use crate::ast::reader::Ast;",
    "use crate::tscore::golang::{List, Text};",
    "use crate::tscore::ids::{NodeId, NodeListId};",
    "",
  );
  const report: string[] = [];
  const getters: string[] = [];
  const setters: string[] = [];

  const fieldOf = (defName: string, goField: string, f: GoFunc): { rust: string; slot: string; index: number } | undefined => {
    const d = defs.get(defName);
    const s = d?.slots.find(x => x.goName === goField);
    if (!d || !s) {
      report.push(`PROBLEM ${f.name}: ${defName}.${goField} is no slot`);
      return undefined;
    }
    return { rust: `self.as_${d.rust}(node).${s.rust}`, slot: s.slot!, index: s.index! };
  };

  for (const f of funcs) {
    const sw = parseSwitch(f.body);
    const where = ELSEWHERE[f.name];
    // A wrapper that returns the nodes of a list.
    const wrap = /^list := n\.(\w+)\(\)$/.exec((f.body[0] ?? "").trim());
    if (wrap && f.ret === "[]*Node" && f.body.map(l => l.trim()).join("|") === `list := n.${wrap[1]}()|if list != nil {|return list.Nodes|}|return nil`) {
      getters.push(`    // Node.${f.name}`, `    pub fn ${field(f.name)}(self, node: NodeId) -> List<'a, NodeId> {`, `        self.nodes(self.${field(wrap[1])}(node))`, "    }");
      report.push(`auto    ${f.name} (ast.go:${f.line}) -> Ast::${field(f.name)}: the nodes of ${field(wrap[1])}`);
      continue;
    }
    if (!sw || where) {
      report.push(`${where ? "core   " : "PROBLEM"} ${f.receiver === "MutableNode" ? "MutableNode." : ""}${f.name} (ast.go:${f.line}) -> ${where ?? "no port named"}`);
      continue;
    }
    if (f.receiver === "MutableNode") {
      // A setter: the slot that the assignment writes, by kind.
      const arms: string[] = [];
      let ok = true;
      for (const arm of sw.arms) {
        const m = /^n\.As(\w+)\(\)\.(\w+) = \w+$/.exec(arm.body.join(" "));
        const target = m && fieldOf(m[1], m[2], f);
        if (!m || !target) {
          ok = false;
          report.push(`PROBLEM MutableNode.${f.name}: case ${arm.kinds.join(",")}: ${arm.body.join(" ")}`);
          continue;
        }
        arms.push(`        ${arm.kinds.map(k => `Kind::${k}`).join(" | ")} => Some((Def::${m[1]}, ${target.index})),`);
      }
      const name = snake(f.name.replace(/^Set/, "")) === "type" ? "type_node" : snake(f.name.replace(/^Set/, ""));
      setters.push(`// MutableNode.${f.name}: the slot that the setter writes. None where upstream panics.`);
      setters.push(`pub fn ${name}_slot(kind: Kind) -> Option<(Def, u8)> {`, "    match kind {", ...arms, "        _ => None,", "    }", "}", "");
      let extra = "";
      if (sw.defaultBody?.some(l => l.includes("FunctionLikeData"))) extra = "; the FunctionLikeData branch of the default case is in the setter itself";
      report.push(`${ok ? "auto   " : "PROBLEM"} MutableNode.${f.name} (ast.go:${f.line}) -> ${name}_slot, used by FileBuilder::set_${name}; a node of an open store through Ast::set_slot${extra}`);
      continue;
    }
    const ret = RETURN_TYPE[f.ret];
    if (!ret) {
      report.push(`PROBLEM ${f.name} (ast.go:${f.line}): return type ${f.ret}`);
      continue;
    }
    const arms: string[] = [];
    let ok = true;
    for (const arm of sw.arms) {
      const line = arm.body.join(" ");
      const m = /^return n\.As(\w+)\(\)\.(\w+)$/.exec(line);
      const pattern = arm.kinds.map(k => `Kind::${k}`).join(" | ");
      if (m) {
        const target = fieldOf(m[1], m[2], f);
        if (!target || !ret.slots.includes(target.slot)) {
          ok = false;
          report.push(`PROBLEM ${f.name}: case ${arm.kinds.join(",")}: ${line}: slot ${target?.slot}`);
          continue;
        }
        arms.push(`            ${pattern} => ${target.rust},`);
      } else if (line === "return true" || line === "return false") {
        arms.push(`            ${pattern} => ${line.slice(7)},`);
      } else {
        ok = false;
        report.push(`PROBLEM ${f.name}: case ${arm.kinds.join(",")}: ${line}`);
      }
    }
    // The default case and what follows the switch.
    const rest: string[] = [];
    const def = (sw.defaultBody ?? []).join(" ");
    const funcLike = /^(?:if funcLike := n\.FunctionLikeData\(\); funcLike != nil \{|funcLike := n\.FunctionLikeData\(\) if funcLike != nil \{) return funcLike\.(\w+) \}$/.exec(def);
    if (funcLike) {
      rest.push(`                if let Some(data) = self.function_like_data(node) {`, `                    return data.${field(funcLike[1])};`, "                }");
    } else if (def !== "" && def !== "return false") {
      ok = false;
      report.push(`PROBLEM ${f.name}: default: ${def}`);
    }
    const tail = sw.tail.join(" ");
    const panic = /^panic\("([^"]*?)(?:: )?"(?: \+ n\.Kind\.String\(\))?\)$/.exec(tail);
    let last: string;
    if (panic) last = `self.unhandled("${panic[1]}", node)`;
    else if (tail === "return nil" || tail === "return false" || (tail === "" && def === "return false")) last = ret.nil;
    else if (f.name === "QuestionToken" && tail === "postfix := n.PostfixToken() if postfix != nil && postfix.Kind == KindQuestionToken { return postfix } return nil") {
      rest.push("                let postfix = self.postfix_token(node);", "                if !postfix.is_nil() && self.kind(postfix) == Kind::QuestionToken {", "                    return postfix;", "                }");
      last = ret.nil;
    } else {
      ok = false;
      report.push(`PROBLEM ${f.name}: tail: ${tail}`);
      last = ret.nil;
    }
    getters.push(`    // Node.${f.name}`, `    pub fn ${field(f.name)}(self, node: NodeId) -> ${ret.rust} {`);
    const allTrue = sw.arms.every(arm => arm.body.join(" ") === "return true");
    if (allTrue && rest.length === 0 && last === "false") {
        const kinds = sw.arms.flatMap(arm => arm.kinds).map(k => `Kind::${k}`).join(" | ");
        getters.push(`        matches!(self.kind(node), ${kinds})`, "    }");
    } else {
        getters.push("        match self.kind(node) {", ...arms);
        if (rest.length) getters.push("            _ => {", ...rest, `                ${last}`, "            }");
        else getters.push(`            _ => ${last},`);
        getters.push("        }", "    }");
    }
    report.push(`${ok ? "auto   " : "PROBLEM"} ${f.name} (ast.go:${f.line}) -> Ast::${field(f.name)}: ${sw.arms.length} cases${panic ? ", panic becomes a fault" : ""}`);
  }
  out.push("impl<'a> Ast<'a> {", ...getters, "}", "", ...setters);
  return { text: out.join("\n"), report };
}
