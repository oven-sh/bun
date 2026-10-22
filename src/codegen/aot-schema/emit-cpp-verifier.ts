import { defaultWordsOf, engineTypeOf, listFirstWord } from "./cpp-types.ts";
import { blocks, cppHeader, cppSource, groupedCases, inNamespace, indent, indentation } from "./lines.ts";
import type { Entry, Field, Kind, Parameter, PayloadField, Schema, Variant } from "./model.ts";
import { isId, payloadWordsOf } from "./model.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

interface PayloadPart {
  readonly kind: Kind;
  readonly isOptional: boolean;
  readonly word: number;
}

type WordAccess = (position: number) => string;

interface VerifyFunctionOptions {
  readonly entries: readonly Entry[];
  readonly signature: string;
  readonly subject: string;
  readonly tag: string;
  readonly enumName: string;
  readonly value: string;
}

const payloadWord: WordAccess = position => `payload.word(${position})`;

function verifierHeader(): string[] {
  return cppHeader(
    [],
    inNamespace("Typed", [
      "void verifyFields(FunctionVerifier&, BlockID, ValueID, const Value&);",
      "void verifyFields(FunctionVerifier&, BlockID, const Terminator&);",
    ]),
  );
}

const helpers = `class PayloadVerifier {
public:
    PayloadVerifier(FunctionVerifier& verifier, BlockID block, ValueID value, const Instruction& instruction)
        : m_verifier(verifier)
        , m_block(block)
        , m_value(value)
        , m_instruction(instruction)
    {
    }

    void fail(InternalErrorKind kind, uint32_t count = 0) { m_verifier.fail(kind, m_block, m_value, count); }
    void require(bool condition) { if (!condition) fail(InternalErrorKind::PayloadOutOfRange); }

    uint32_t word(unsigned position) const { return m_instruction.payloadWordAt(position); }
    std::span<const uint32_t> list(unsigned firstWord) const { return m_instruction.payloadListFrom(firstWord); }
    bool isAbsent(unsigned position) const { return word(position) == absentPayloadWord; }
    bool isBefore(IRForm form) const { return m_verifier.form() < form; }
    const BuiltinTable& builtins() const { return m_verifier.program().builtins(); }

    template<typename IDType> void id(uint32_t word) { require(m_verifier.isValid(IDType(word))); }
    template<typename External> void externalID(uint32_t word) { require(builtins().contains(External(word))); }
    template<typename E> void enumerator(uint32_t word) { require(word < numberOfEnumerators<E>); }
    template<typename F> void flags(uint32_t word) { require(!(static_cast<uint64_t>(word) >> numberOfEnumerators<F>)); }
    void boolean(uint32_t word) { require(word <= 1); }
    void field(uint32_t layout, uint32_t field) { require(m_verifier.isValidField(LayoutID(layout), field)); }

    template<typename Entry>
    void operands(Entry entry)
    {
        for (uint32_t i = 0; i < numberOfNamedOperandsOf(entry); ++i) {
            if (!m_instruction.operand(i) && !operandInfoOf(entry, i).isOptional)
                fail(InternalErrorKind::OperandMissing, i);
        }
        if (!hasVariadicOperand(entry) && m_instruction.numberOfVariadicOperands())
            fail(InternalErrorKind::UnexpectedOperand);
        for (ValueID operand : m_instruction.variadicOperands()) {
            if (!operand)
                fail(InternalErrorKind::OperandMissing, numberOfNamedOperandsOf(entry));
        }
        const Function& source = m_verifier.program().sourceFunctionOf(m_verifier.function(), m_instruction);
        if (!source.flags.containsAll(requiresOf(entry)))
            fail(InternalErrorKind::FunctionFlagMissing);
        if (isIntrinsicOf(entry) && source.role == FunctionRole::Source && m_verifier.form() == IRForm::AsRead && !m_verifier.isOptimizing())
            fail(InternalErrorKind::IntrinsicOutsideLibraryCode);
    }

private:
    FunctionVerifier& m_verifier;
    BlockID m_block;
    ValueID m_value;
    const Instruction& m_instruction;
};`.split("\n");

function wordCheck(kind: Kind, word: string, layoutWord: number | null): string | null {
  switch (kind.tag) {
    case "Id":
      return `payload.id<${engineTypeOf(kind)}>(${word});`;
    case "External":
      if (kind.external.form === "id") return `payload.externalID<${engineTypeOf(kind)}>(${word});`;
      if (kind.external.below !== null) return `payload.require(${word} < ${kind.external.below});`;
      return `payload.require(isValid${kind.external.cppType.split("::").at(-1)}(${word}, payload.builtins()));`;
    case "Enum":
      return `payload.enumerator<${engineTypeOf(kind)}>(${word});`;
    case "Flags":
      return `payload.flags<${kind.type.name}>(${word});`;
    case "Scalar":
      if (kind.scalar === "Bool") return `payload.boolean(${word});`;
      if (kind.scalar !== "Field" || layoutWord === null) return null;
      return `payload.field(payload.word(${layoutWord}), ${word});`;
    case "PlacedWord":
    case "Record":
    case "Variant":
    case "Span":
    case "List":
      return null;
  }
}

function flatFields(kind: Kind, isOptional: boolean, first: number): PayloadPart[] {
  return kind.tag === "Record" ? flatFieldsOf(kind.record.fields, first) : [{ kind, isOptional, word: first }];
}

function flatFieldsOf(fields: readonly Field[], first: number): PayloadPart[] {
  const parts: PayloadPart[] = [];
  let word = first;
  for (const field of fields) {
    parts.push(...flatFields(field.kind, field.isOptional, word));
    word += field.payloadWords;
  }
  return parts;
}

function variantCheck(variant: Variant, first: number, access: WordAccess): string[] {
  const lines = [`payload.require(${access(first)} < ${variant.cases.length});`];
  for (const variantCase of variant.cases) {
    const body = flatFieldsOf(variantCase.fields, first + 1).flatMap(part => guardedCheck(part, access, null));
    if (body.length > 0) lines.push(`if (${access(first)} == ${variantCase.number}) {`, ...indent(body), "}");
  }
  return lines;
}

function guardedCheck(part: PayloadPart, access: WordAccess, layoutWord: number | null): string[] {
  if (part.kind.tag === "Variant") return variantCheck(part.kind.variant, part.word, access);
  const word = access(part.word);
  const check = wordCheck(part.kind, word, layoutWord);
  if (check === null) return [];
  return part.isOptional ? [`if (${word} != absentPayloadWord)`, indentation + check] : [check];
}

function wordOf(parameter: PayloadField): number {
  if (parameter.firstWord === null) throw new Error(`payload field ${parameter.name} is a list and has no fixed word`);
  return parameter.firstWord;
}

function scalarChecks(parameter: PayloadField, layoutWord: number | null): string[] {
  const parts = flatFields(parameter.kind, parameter.isOptional, wordOf(parameter));
  return parts.flatMap(part => guardedCheck(part, payloadWord, layoutWord));
}

function listChecks(entry: Entry, element: Kind, layoutWord: number | null): string[] {
  const list = `payload.list(${listFirstWord(entry)})`;
  const stride = payloadWordsOf(element);
  const parts = flatFields(element, false, 0);
  if (stride === 1) {
    const checks = parts.flatMap(part => guardedCheck(part, () => "word", layoutWord));
    return checks.length === 0 ? [] : [`for (uint32_t word : ${list})`, ...indent(checks)];
  }
  const access: WordAccess = position => (position === 0 ? "words[offset]" : `words[offset + ${position}]`);
  const body = parts.flatMap(part => guardedCheck(part, access, null));
  const loop =
    body.length === 0
      ? []
      : [`for (size_t offset = 0; offset + ${stride} <= words.size(); offset += ${stride}) {`, ...indent(body), "}"];
  return ["{", ...indent([`auto words = ${list};`, `payload.require(!(words.size() % ${stride}));`, ...loop]), "}"];
}

function isRequiredId(parameter: PayloadField): boolean {
  return !parameter.isOptional && isId(parameter.kind);
}

function formChecks(parameter: PayloadField): string[] {
  if (parameter.firstForm === "AsRead" || parameter.kind.tag === "List" || parameter.payloadWords !== 1) return [];
  const word = wordOf(parameter);
  const [defaultWord] = defaultWordsOf(parameter.kind, parameter.isOptional);
  const unset = defaultWord === "UINT32_MAX" ? "absentPayloadWord" : defaultWord;
  const lines = [
    `if (payload.isBefore(IRForm::${parameter.firstForm}))`,
    `${indentation}payload.require(payload.word(${word}) == ${unset});`,
  ];
  if (isRequiredId(parameter)) {
    lines.push(
      `else if (payload.isAbsent(${word}))`,
      `${indentation}payload.fail(InternalErrorKind::PlacedPayloadMissing);`,
      "else",
      ...indent(scalarChecks(parameter, null)),
    );
  }
  return lines;
}

function presence(parameter: Parameter, subject: string): string {
  if (parameter.tag === "Operand") return `!!${subject}.operand(${parameter.index})`;
  return `!payload.isAbsent(${wordOf(parameter)})`;
}

function verifyEntry(entry: Entry, subject: string): string[] {
  const layout = entry.payload.find(
    parameter => parameter.name === "layout" && parameter.kind.tag === "Id" && parameter.kind.id.name === "Layout",
  );
  const layoutWord = layout === undefined ? null : wordOf(layout);
  const lines: string[] = [];
  for (const parameter of entry.payload) {
    lines.push(...formChecks(parameter));
    if (parameter.firstForm !== "AsRead" && isRequiredId(parameter)) continue;
    if (parameter.kind.tag === "List") lines.push(...listChecks(entry, parameter.kind.element, layoutWord));
    else lines.push(...scalarChecks(parameter, layoutWord));
  }
  const exactlyOneOf = entry.columns.get("exactlyOneOf");
  if (exactlyOneOf?.tag === "Parameters") {
    const [first, second] = exactlyOneOf.parameters;
    lines.push(
      `if (${presence(first, subject)} == ${presence(second, subject)})`,
      `${indentation}payload.fail(InternalErrorKind::NotExactlyOneParameter);`,
    );
  }
  return [...lines, "return;"];
}

function verifyFunction(options: VerifyFunctionOptions): string[] {
  const { entries, signature, subject, tag, enumName, value } = options;
  return [
    signature,
    "{",
    `${indentation}PayloadVerifier payload(verifier, block, ${value}, ${subject});`,
    `${indentation}payload.operands(${subject}.${tag});`,
    `${indentation}switch (${subject}.${tag}) {`,
    ...groupedCases(
      enumName,
      entries.map(entry => ({ label: entry.name, body: verifyEntry(entry, subject) })),
    ),
    `${indentation}}`,
    `${indentation}RELEASE_ASSERT_NOT_REACHED();`,
    "}",
  ];
}

function verifierSource(schema: Schema): string[] {
  const definitions = blocks(
    helpers,
    verifyFunction({
      entries: schema.operations,
      signature: "void verifyFields(FunctionVerifier& verifier, BlockID block, ValueID id, const Value& value)",
      subject: "value",
      tag: "opcode",
      enumName: "Opcode",
      value: "id",
    }),
    verifyFunction({
      entries: schema.terminators,
      signature: "void verifyFields(FunctionVerifier& verifier, BlockID block, const Terminator& terminator)",
      subject: "terminator",
      tag: "kind",
      enumName: "TerminatorKind",
      value: "ValueID()",
    }),
  );
  const includes = ['"AOTVerifierInternal.h"', '"AOTBuiltinTable.h"', '"IterationKind.h"', '"TypedArrayType.h"'];
  return cppSource(includes, inNamespace("Typed", definitions));
}

export function emitCppVerifier(context: EmitContext): OutputFile[] {
  return [
    { name: "AOTSchemaVerifier.h", lines: verifierHeader() },
    { name: "AOTSchemaVerifier.cpp", lines: verifierSource(context.schema) },
  ];
}
