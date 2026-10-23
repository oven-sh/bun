import { groupedArms } from "./emit-rust-references.ts";
import { blocks, indentation, rustMarker } from "./lines.ts";
import type { Entry, Member, Operand, ResultRule, Schema } from "./model.ts";
import { screamingCase } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

const twoLevels = indentation.repeat(2);

const declarations = `#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Retainer {
    UnknownMemory,
    Result,
    Operand(u8),
}

#[derive(Copy, Clone, Debug)]
pub struct OperandInfo {
    pub uses: OperandUse,
    pub protocols: Protocol,
    pub retainer: Retainer,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ResultOrigin {
    Nothing,
    Constant,
    Allocation,
    Call,
    Read { receiver: u8 },
    Computed,
    Other,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RetainingHeap {
    ModuleVariables,
    EnvironmentFields,
    Other,
}`.split("\n");

const heapsOfBookkeeping = new Set(["AllocatorState", "StringStorage", "RuntimeState"]);

function operandsOf(entry: Entry): Operand[] {
  return entry.variadicOperand === null ? [...entry.namedOperands] : [...entry.namedOperands, entry.variadicOperand];
}

function flagsText(type: string, members: readonly Member[]): string {
  if (members.length === 0) return `${type}(0)`;
  return `${type}(${members.map(member => `${type}::${screamingCase(member.name)}.0`).join(" | ")})`;
}

function retainerText(operand: Operand): string {
  const { retainedIn, retainingOperand } = operand.uses;
  return retainedIn === "Operand" ? `Retainer::Operand(${retainingOperand})` : `Retainer::${retainedIn}`;
}

function operandInfoText(operand: Operand): string {
  const { uses, protocols } = operand.uses;
  return `OperandInfo { uses: ${flagsText("OperandUse", uses)}, protocols: ${flagsText("Protocol", protocols)}, retainer: ${retainerText(operand)} },`;
}

function memberOf(entry: Entry, column: string): string | null {
  const value = entry.columns.get(column);
  return value?.tag === "Member" ? value.member.name : null;
}

function operandOf(entry: Entry, column: string): Operand | null {
  const value = entry.columns.get(column);
  return value?.tag === "Operand" ? value.operand : null;
}

function has(operand: Operand, use: string): boolean {
  return operand.uses.uses.some(member => member.name === use);
}

function receiverOfDeclaredResult(rule: ResultRule | null): Operand | null {
  if (rule === null || rule.rule !== "Declared") return null;
  if (rule.declared.tag === "Contents") return rule.declared.operand;
  return rule.declared.tag === "Key" ? rule.declared.receiver : null;
}

function receiverOfRead(entry: Entry): Operand | null {
  const isRead = memberOf(entry, "access") === "Read" || memberOf(entry, "interpreted") === "Read";
  if (isRead) return operandOf(entry, "receiver") ?? entry.namedOperands[0] ?? null;
  return receiverOfDeclaredResult(entry.result.proven) ?? receiverOfDeclaredResult(entry.result.unproven);
}

// What the result of an operation is to somebody who follows values through a function without their types.
function resultOriginOf(entry: Entry): string {
  const operands = operandsOf(entry).filter(operand => !operand.isEngine);
  const result = entry.result.unproven;
  const rule = result.rule;
  if (rule === "None") return "ResultOrigin::Nothing";
  // The result is an operand. Only a cast and a result that is the same as an operand are never anything else.
  if (operands.some(operand => has(operand, "Returns"))) {
    const isOperandAlone = rule === "Cast" || (result.rule === "Natural" && result.natural.tag === "SameAs");
    return isOperandAlone ? "ResultOrigin::Nothing" : "ResultOrigin::Other";
  }
  const accessClass = memberOf(entry, "accessClass");
  if (accessClass === "IndirectCall" || accessClass === "DirectCall") return "ResultOrigin::Call";
  if (rule === "Constant" && operands.length === 0 && !entry.effects.collects && !entry.effects.throws)
    return "ResultOrigin::Constant";
  // One object for the place in the program, the same whenever the operation runs: whoever has run it before has it too.
  if (memberOf(entry, "boundTo") === "Site") return "ResultOrigin::Other";
  const retainsInResult = operands.some(operand => operand.uses.retainedIn === "Result");
  if (rule === "Allocation" || memberOf(entry, "flow") === "Allocates" || retainsInResult)
    return "ResultOrigin::Allocation";
  const receiver = receiverOfRead(entry);
  if (receiver !== null && !receiver.isVariadic) return `ResultOrigin::Read { receiver: ${receiver.index} }`;
  // The operation alone says what kind of value comes out, whatever it does to its operands on the way.
  return rule === "Natural" ? "ResultOrigin::Computed" : "ResultOrigin::Other";
}

function retainingHeapOf(entry: Entry): string {
  const written = new Set(entry.effects.writes.map(reference => reference.heap.name));
  if (written.has("ModuleVariables")) return "RetainingHeap::ModuleVariables";
  return written.has("EnvironmentFields") ? "RetainingHeap::EnvironmentFields" : "RetainingHeap::Other";
}

// The object is made from what the operation itself names alone: it has no operand that could say what the object holds.
function isMadeFromPayload(entry: Entry): boolean {
  const hasOperands = operandsOf(entry).some(operand => !operand.isEngine);
  return (
    resultOriginOf(entry) === "ResultOrigin::Allocation" && entry.result.unproven.rule === "Constant" && !hasOperands
  );
}

function definesMembers(entry: Entry): boolean {
  return memberOf(entry, "access") === "Define";
}

// `Opcode` belongs to another crate in the product, so these are functions and not its methods.
function answerFunction(head: string, entries: readonly Entry[], answerOf: (entry: Entry) => string[]): string[] {
  const bodies = entries.map(entry => ({ label: entry.name, body: answerOf(entry) }));
  return [
    `${head} {`,
    `${indentation}match opcode {`,
    ...groupedArms("Opcode", bodies, twoLevels),
    `${indentation}}`,
    "}",
  ];
}

function entryUsesRs(schema: Schema): string[] {
  const operations = schema.operations.filter(entry => entry.isWire);
  return [
    rustMarker,
    "",
    "use super::entries::Opcode;",
    "use super::enums::{OperandUse, Protocol};",
    "",
    ...blocks(
      declarations,
      [
        "// By the index of the operand. Where the operation takes any number of operands the last entry stands for all of them.",
        ...answerFunction("pub fn operand_infos_of(opcode: Opcode) -> &'static [OperandInfo]", operations, entry => {
          const operands = operandsOf(entry);
          return operands.length === 0
            ? ["&[]"]
            : ["&[", ...operands.map(operand => indentation + operandInfoText(operand)), "]"];
        }),
      ],
      answerFunction("pub fn result_origin_of(opcode: Opcode) -> ResultOrigin", operations, entry => [
        resultOriginOf(entry),
      ]),
      answerFunction("pub fn retaining_heap_of(opcode: Opcode) -> RetainingHeap", operations, entry => [
        retainingHeapOf(entry),
      ]),
      answerFunction("pub fn is_made_from_payload(opcode: Opcode) -> bool", operations, entry => [
        String(isMadeFromPayload(entry)),
      ]),
      answerFunction("pub fn defines_members(opcode: Opcode) -> bool", operations, entry => [
        String(definesMembers(entry)),
      ]),
      answerFunction("pub fn compares_identity(opcode: Opcode) -> bool", operations, entry => [
        String(memberOf(entry, "proves") === "Equality"),
      ]),
    ),
  ];
}

export function emitRustUses(context: EmitContext): OutputFile[] {
  return [{ name: "entry_uses.rs", lines: entryUsesRs(context.schema) }];
}
