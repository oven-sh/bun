import {
  engineFieldsOf,
  engineStructNameOf,
  engineTypeOf,
  hasEngineStruct,
  listFirstWord,
  sectionElementTypeOf,
  twoWordScalars,
} from "./cpp-types.ts";
import { kindText } from "./hash.ts";
import { blocks, cppHeader, cppSource, groupedCases, indent, inNamespace } from "./lines.ts";
import type {
  Entry,
  External,
  Field,
  Kind,
  PayloadField,
  ScalarKind,
  Schema,
  SchemaRecord,
  SchemaType,
  Variant,
} from "./model.ts";
import {
  entriesOf,
  fieldsOf,
  innermostKindOf,
  isNested,
  isStringKey,
  isWireType,
  nameOf,
  payloadWordsOf,
  wireParametersOf,
} from "./model.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { wireFieldsOf, wireTypesOf } from "./rust-types.ts";
import { SchemaError } from "./source.ts";

export { innermostKindOf as innermost } from "./model.ts";

const borrowedSpanReaders: Readonly<Partial<Record<ScalarKind, string>>> = {
  Byte: "bytes",
  Word: "words",
  CodeWord: "code",
};

const recursionHelpers = `struct RecursiveRead {
    uint64_t remainingRecords { 0 };
    uint64_t depth { 0 };
};

static bool enterSpan(RecordChecker& checker, RecursiveRead& recursion, size_t numberOfRecords)
{
    constexpr uint64_t maxDepth = std::max(valueOnARM64Of(LimitID::MaxNestingDepth), valueOnX86_64Of(LimitID::MaxNestingDepth));
    if (recursion.depth >= maxDepth || numberOfRecords > recursion.remainingRecords) {
        checker.fail(InternalErrorKind::DuplicateListEntry);
        return false;
    }
    recursion.remainingRecords -= numberOfRecords;
    ++recursion.depth;
    return true;
}`.split("\n");

const decoderHelpers = `template<typename E>
static uint32_t nextEnumerator(BodyDecoder& decoder)
{
    uint32_t word = decoder.next();
    if (decoder.form() == IRForm::AsRead)
        return static_cast<uint32_t>(decoder.checker().enumerator<E>(word));
    if (word >= numberOfEnumerators<E>)
        decoder.fail(InternalErrorKind::UnknownEnumerator);
    return word;
}

template<typename E>
static uint32_t nextOptionalEnumerator(BodyDecoder& decoder)
{
    uint32_t word = decoder.next();
    if (word == Wire::none)
        return word;
    if (decoder.form() == IRForm::AsRead)
        return static_cast<uint32_t>(decoder.checker().enumerator<E>(word));
    if (word >= numberOfEnumerators<E>)
        decoder.fail(InternalErrorKind::UnknownEnumerator);
    return word;
}

template<typename F>
static uint32_t nextFlagWord(BodyDecoder& decoder)
{
    uint32_t word = decoder.next();
    if (decoder.form() == IRForm::AsRead)
        return static_cast<uint32_t>(decoder.checker().flags<F>(word).toRaw());
    if (static_cast<uint64_t>(word) >> numberOfEnumerators<F>)
        decoder.fail(InternalErrorKind::UnknownFlag);
    return word;
}

template<typename IDType>
static uint32_t nextID(BodyDecoder& decoder)
{
    return decoder.checker().id<IDType>(decoder.next()).index();
}

template<typename IDType>
static uint32_t nextOptionalID(BodyDecoder& decoder)
{
    return decoder.checker().optionalID<IDType>(decoder.next()).index();
}

template<typename External>
static uint32_t nextExternal(BodyDecoder& decoder)
{
    uint32_t word = decoder.next();
    decoder.checker().external<External>(word);
    return word;
}

template<typename External>
static uint32_t nextOptionalExternal(BodyDecoder& decoder)
{
    uint32_t word = decoder.next();
    if (word != Wire::none)
        decoder.checker().external<External>(word);
    return word;
}

static uint32_t nextBoolean(BodyDecoder& decoder)
{
    return decoder.checker().boolean(decoder.next());
}

// An operation whose words on the wire are a fixed number is decoded without a test between its words. Where a word is not valid, the words are decoded again one by one,
// which finds the error to report.
template<typename E>
static uint32_t checkedEnumerator(uint32_t word, bool& isValid)
{
    isValid &= word < numberOfWireEnumerators<E>;
    return word;
}

template<typename E>
static uint32_t checkedOptionalEnumerator(uint32_t word, bool& isValid)
{
    isValid &= word < numberOfWireEnumerators<E> || word == Wire::none;
    return word;
}

template<typename F>
static uint32_t checkedFlagWord(uint32_t word, bool& isValid)
{
    constexpr uint64_t wireMask = (uint64_t { 1 } << numberOfWireEnumerators<F>) - 1;
    isValid &= !(word & ~wireMask);
    return word;
}

static uint32_t checkedBoolean(uint32_t word, bool& isValid)
{
    isValid &= word <= 1;
    return word;
}

static void setCheckedDeclaredType(BodyDecoder& decoder, Instruction& instruction, unsigned firstWord, const uint32_t* words, bool& isValid)
{
    static_assert(sizeof(Wire::DeclaredType) == 3 * sizeof(uint32_t) && PayloadWords<DeclaredType>::count == 3);
    static_assert(!offsetof(Wire::DeclaredType, type) && offsetof(Wire::DeclaredType, site) == sizeof(uint32_t) && offsetof(Wire::DeclaredType, flags) == 2 * sizeof(uint32_t));
    constexpr uint32_t flagsThatExcludeEachOther = OptionSet<PositionFlags> { PositionFlags::IsExpected, PositionFlags::IsInt32Promise }.toRaw();
    uint32_t flags = checkedFlagWord<PositionFlags>(words[2], isValid);
    isValid &= (flags & flagsThatExcludeEachOther) != flagsThatExcludeEachOther;
    instruction.setPayloadWordAt(firstWord, decoder.checkedID<TypeID>(words[0], isValid));
    instruction.setPayloadWordAt(firstWord + 1, decoder.checkedOptionalID<TypeSiteID>(words[1], isValid));
    instruction.setPayloadWordAt(firstWord + 2, flags);
}

template<typename WireRecord, typename Record>
static Record nextRecord(BodyDecoder& decoder)
{
    std::array<uint32_t, sizeof(WireRecord) / sizeof(uint32_t)> words;
    for (uint32_t& word : words)
        word = decoder.next();
    Record record;
    read(decoder.checker(), std::bit_cast<WireRecord>(words), record);
    return record;
}

template<typename WireRecord, typename Record>
static void decodeRecord(BodyDecoder& decoder, Instruction& instruction, unsigned firstWord)
{
    encodePayloadRecord(instruction, firstWord, nextRecord<WireRecord, Record>(decoder));
}

template<typename WireRecord, typename Record>
static void decodeRecordList(BodyDecoder& decoder, Instruction& instruction, unsigned firstWord)
{
    uint32_t count = decoder.nextCount(sizeof(WireRecord) / sizeof(uint32_t));
    Vector<Record, 4> records;
    for (uint32_t i = 0; i < count && !decoder.hasFailed(); ++i)
        records.append(nextRecord<WireRecord, Record>(decoder));
    instruction.setPayloadListFrom(firstWord, encodePayloadList(records.span()).span());
}

template<typename Functor>
static void decodeWordList(BodyDecoder& decoder, Instruction& instruction, unsigned firstWord, unsigned wordsPerElement, const Functor& nextWord)
{
    uint32_t count = decoder.nextCount(wordsPerElement);
    Vector<uint32_t, 16> words;
    for (uint64_t i = 0; i < static_cast<uint64_t>(count) * wordsPerElement && !decoder.hasFailed(); ++i)
        words.append(nextWord(decoder));
    instruction.setPayloadListFrom(firstWord, words.span());
}

static uint32_t nextWord(BodyDecoder& decoder)
{
    return decoder.next();
}`.split("\n");

export function convertedTypes(schema: Schema): SchemaType[] {
  return wireTypesOf(schema).filter(hasEngineStruct);
}

function externalsRead(schema: Schema): External[] {
  const kinds = [
    ...wireTypesOf(schema).flatMap(type => fieldsOf(type).map(field => field.kind)),
    ...entriesOf(schema).flatMap(entry => entry.payload.map(field => field.kind)),
  ];
  const used = new Set<string>();
  for (const kind of kinds) {
    const inner = innermostKindOf(kind);
    if (inner.tag === "External") used.add(inner.external.name);
  }
  return schema.externals.filter(external => used.has(external.name));
}

function externalTest(external: External): string {
  const type = external.cppType;
  const head = `template<> inline bool isValidExternal<${type}>(uint32_t word, const BuiltinTable&`;
  if (external.form === "id") return `${head} builtins) { return builtins.contains(${type}(word)); }`;
  if (external.below !== null) return `${head}) { return word < ${external.below}; }`;
  return `${head} builtins) { return isValid${type.split("::").at(-1)}(word, builtins); }`;
}

function readerHeader(schema: Schema): string[] {
  return cppHeader(
    [],
    inNamespace("Typed", [
      ...externalsRead(schema).map(externalTest),
      "",
      ...convertedTypes(schema).map(
        type => `void read(RecordChecker&, const Wire::${nameOf(type)}&, ${engineStructNameOf(type)}&);`,
      ),
      "",
      "void decodeFields(BodyDecoder&, Value&);",
      "void decodeFields(BodyDecoder&, Terminator&);",
    ]),
  );
}

export function isWireId(schema: Schema, name: string): boolean {
  return schema.idKinds.some(id => id.name === name && !id.isEngine);
}

function checkedWord(kind: Kind, isOptional: boolean, word: string): string {
  const type = engineTypeOf(kind);
  switch (kind.tag) {
    case "Id":
      if (kind.id.isEngine) return `${type}(${word})`;
      return `checker.${isOptional ? "optionalID" : "id"}<${type}>(${word})`;
    case "External": {
      const optionalReader = kind.external.form === "id" ? "optionalExternalID" : "optionalExternalEnumerator";
      return `checker.${isOptional ? optionalReader : "external"}<${type}>(${word})`;
    }
    case "Enum":
      return `checker.${isOptional ? "optionalEnumerator" : "enumerator"}<${type}>(${word})`;
    case "Flags":
      return `checker.flags<${kind.type.name}>(${word})`;
    case "PlacedWord":
      return `${type}(${word})`;
    case "Scalar":
      if (kind.scalar === "Bool") return `checker.boolean(${word})`;
      if (kind.scalar === "UInt32" || kind.scalar === "Field")
        return isOptional ? `checker.optionalNumber(${word})` : word;
      break;
    case "Record":
    case "Variant":
    case "Span":
    case "List":
      break;
  }
  throw new Error(`${kindText(kind)} is not one word`);
}

function containedTypes(type: SchemaType): SchemaType[] {
  return wireFieldsOf(type).flatMap(field => {
    const inner = innermostKindOf(field.kind);
    return isNested(inner) ? [inner] : [];
  });
}

function recursiveTypes(schema: Schema): SchemaType[] {
  const reaches = (start: string, type: SchemaType, seen: Set<string>): boolean =>
    containedTypes(type).some(inner => {
      const name = nameOf(inner);
      if (name === start) return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return reaches(start, inner, seen);
    });
  return convertedTypes(schema).filter(type => reaches(nameOf(type), type, new Set()));
}

function ascendingCheck(elements: string, key: Field | null): string[] {
  const access = key === null ? "" : `.${key.name}`;
  const previous = `${elements}[i - 1]${access}`;
  const next = `${elements}[i]${access}`;
  const check =
    key !== null && isStringKey(key)
      ? `checker.requireAscendingStrings(${checkedWord(key.kind, false, previous)}, ${checkedWord(key.kind, false, next)});`
      : `checker.requireAscending(${previous}, ${next});`;
  return [`for (size_t i = 1; i < ${elements}.size(); ++i)`, `    ${check}`];
}

function readSpan(recursiveCallees: readonly string[], field: Field, source: string, target: string): string[] {
  const element = innermostKindOf(field.kind);
  const borrowedReader = element.tag === "Scalar" ? borrowedSpanReaders[element.scalar] : undefined;
  if (borrowedReader !== undefined) return [`${target} = checker.${borrowedReader}(${source});`];
  if (!isNested(element)) {
    return [
      "{",
      `    auto words = checker.words(${source});`,
      ...indent(field.isSorted ? ascendingCheck("words", null) : []),
      `    ${target}.reserveInitialCapacity(words.size());`,
      "    for (uint32_t word : words)",
      `        ${target}.append(${checkedWord(element, false, "word")});`,
      "}",
    ];
  }
  const isRecursive = recursiveCallees.includes(nameOf(element));
  const readElements = [
    `${target}.grow(elements.size());`,
    "for (size_t i = 0; i < elements.size(); ++i)",
    `    read(checker, elements[i], ${target}[i]${isRecursive ? ", recursion" : ""});`,
  ];
  const readWithinBudget = [
    "if (enterSpan(checker, recursion, elements.size())) {",
    ...indent(readElements),
    "    --recursion.depth;",
    "}",
  ];
  return [
    "{",
    `    auto elements = checker.slice<Wire::${nameOf(element)}>(${source});`,
    ...indent(field.isSorted ? ascendingCheck("elements", field.sortedBy) : []),
    ...indent(isRecursive ? readWithinBudget : readElements),
    "}",
  ];
}

function readField(recursiveCallees: readonly string[], field: Field): string[] {
  const kind = field.kind;
  const source = `wire.${field.name}`;
  const target = `record.${field.name}`;
  if (kind.tag === "Span") return readSpan(recursiveCallees, field, source, target);
  if (isNested(kind))
    return [`read(checker, ${source}, ${target}${recursiveCallees.includes(nameOf(kind)) ? ", recursion" : ""});`];
  if (kind.tag === "Scalar" && kind.scalar === "Double")
    return [`${target} = std::bit_cast<double>(static_cast<uint64_t>(${source}));`];
  if (kind.tag === "Scalar" && twoWordScalars.has(kind.scalar)) return [`${target} = ${source};`];
  return [`${target} = ${checkedWord(kind, field.isOptional, source)};`];
}

function readSignature(recursive: readonly string[], type: SchemaType): string {
  const parameters = `RecordChecker& checker, const Wire::${nameOf(type)}& wire, ${engineStructNameOf(type)}& record`;
  return recursive.includes(nameOf(type))
    ? `static void read(${parameters}, RecursiveRead& recursion)`
    : `void read(${parameters})`;
}

function readRecord(recursive: readonly string[], record: SchemaRecord): string[] {
  const recursiveCallees = recursive.includes(record.name) ? recursive : [];
  const fields = engineFieldsOf(record).filter(field => !field.isEngine);
  return [
    readSignature(recursive, { tag: "Record", record }),
    "{",
    ...indent(fields.flatMap(field => readField(recursiveCallees, field))),
    "    checker.didRead(record);",
    "}",
  ];
}

export function caseWords(schema: Schema, fields: readonly Field[]): [Field, number][] {
  const positions: [Field, number][] = [];
  let word = 0;
  for (const field of fields) {
    positions.push([field, word]);
    word += field.wireWords;
  }
  return positions;
}

function readCaseField(recursiveCallees: readonly string[], variant: Variant, field: Field, word: number): string[] {
  const kind = field.kind;
  const target = `value.${field.name}`;
  const low = `wire.words[${word}]`;
  const high = `wire.words[${word + 1}]`;
  if (kind.tag === "Span") return readSpan(recursiveCallees, field, `Wire::Span { ${low}, ${high} }`, target);
  if (isNested(kind)) {
    throw new SchemaError(
      field.location,
      `field ${field.name} of ${variant.name}: a case of a wire variant cannot hold ${nameOf(kind)}`,
    );
  }
  if (kind.tag === "Scalar" && kind.scalar === "Double")
    return [`${target} = std::bit_cast<double>(static_cast<uint64_t>(${high}) << 32 | ${low});`];
  if (kind.tag === "Scalar" && twoWordScalars.has(kind.scalar)) {
    return [`${target} = static_cast<${engineTypeOf(kind)}>(static_cast<uint64_t>(${high}) << 32 | ${low});`];
  }
  return [`${target} = ${checkedWord(kind, field.isOptional, low)};`];
}

function readVariant(schema: Schema, recursive: readonly string[], variant: Variant): string[] {
  const recursiveCallees = recursive.includes(variant.name) ? recursive : [];
  const cases = variant.cases.flatMap(variantCase => {
    const label = `case ${variant.name}::Kind::${variantCase.name}:`;
    const caseType = `${variant.name}::${variantCase.name}`;
    if (variantCase.fields.length === 0) return [label, `    record = ${caseType} { };`, "    break;"];
    return [
      `${label} {`,
      `    ${caseType} value;`,
      ...indent(
        caseWords(schema, variantCase.fields).flatMap(([field, word]) =>
          readCaseField(recursiveCallees, variant, field, word),
        ),
      ),
      "    record = WTF::move(value);",
      "    break;",
      "}",
    ];
  });
  return [
    readSignature(recursive, { tag: "Variant", variant }),
    "{",
    `    if (wire.kind >= ${variant.cases.length}) {`,
    "        checker.fail(InternalErrorKind::UnknownVariantCase);",
    "        return;",
    "    }",
    `    switch (static_cast<${variant.name}::Kind>(wire.kind)) {`,
    ...indent(cases),
    "    }",
    "    checker.didRead(record);",
    "}",
  ];
}

function recursionSupport(recursive: readonly SchemaType[]): string[] {
  if (recursive.length === 0) return [];
  return [
    ...recursionHelpers,
    "",
    ...recursive.map(
      type =>
        `static void read(RecordChecker&, const Wire::${nameOf(type)}&, ${engineStructNameOf(type)}&, RecursiveRead&);`,
    ),
  ];
}

function recursionBudget(schema: Schema, recursive: readonly string[]): string {
  const lists = recursive.flatMap(name => schema.lists.find(list => sectionElementTypeOf(list.element) === name) ?? []);
  const sizes = lists.map(list => `sections.${list.name}.size()`);
  return sizes.map((size, index) => (index === 0 ? `static_cast<uint64_t>(${size})` : size)).join(" + ");
}

function recursionEntry(type: SchemaType, budget: string): string[] {
  return [
    readSignature([], type),
    "{",
    "    const Wire::Sections& sections = checker.reader().sections();",
    `    RecursiveRead recursion { ${budget} };`,
    "    read(checker, wire, record, recursion);",
    "}",
  ];
}

function recordReaderSource(schema: Schema): string[] {
  const recursiveStructs = recursiveTypes(schema);
  const recursive = recursiveStructs.map(type => nameOf(type));
  const budget = recursionBudget(schema, recursive);
  const functions = convertedTypes(schema).flatMap(type => {
    const read =
      type.tag === "Record" ? readRecord(recursive, type.record) : readVariant(schema, recursive, type.variant);
    return recursive.includes(nameOf(type)) ? [read, recursionEntry(type, budget)] : [read];
  });
  return cppSource(
    ['"AOTReaderInternal.h"', "<algorithm>", "<bit>"],
    inNamespace("Typed", blocks(recursionSupport(recursiveStructs), ...functions)),
  );
}

function nextWordFunction(kind: Kind, isOptional: boolean): string {
  const type = engineTypeOf(kind);
  if (kind.tag === "Id" && !kind.id.isEngine) return `${isOptional ? "nextOptionalID" : "nextID"}<${type}>`;
  if (kind.tag === "External") return `${isOptional ? "nextOptionalExternal" : "nextExternal"}<${type}>`;
  if (kind.tag === "Enum") return `${isOptional ? "nextOptionalEnumerator" : "nextEnumerator"}<${type}>`;
  if (kind.tag === "Flags") return `nextFlagWord<${kind.type.name}>`;
  if (kind.tag === "Scalar" && kind.scalar === "Bool") return "nextBoolean";
  return "nextWord";
}

function decodeList(entry: Entry, element: Kind, subject: string): string {
  const firstWord = listFirstWord(entry);
  if (isNested(element) && isWireType(element)) {
    return `decodeRecordList<Wire::${nameOf(element)}, ${engineTypeOf(element)}>(decoder, ${subject}, ${firstWord});`;
  }
  return `decodeWordList(decoder, ${subject}, ${firstWord}, ${payloadWordsOf(element)}, ${nextWordFunction(element, false)});`;
}

function decodePayload(entry: Entry, parameter: PayloadField, subject: string): string[] {
  const kind = parameter.kind;
  if (kind.tag === "List") return [decodeList(entry, kind.element, subject)];
  const firstWord = parameter.firstWord;
  if (firstWord === null) throw new Error(`payload field ${parameter.name} of ${entry.name} has no payload word`);
  if (isNested(kind)) {
    if (isWireType(kind))
      return [`decodeRecord<Wire::${nameOf(kind)}, ${engineTypeOf(kind)}>(decoder, ${subject}, ${firstWord});`];
    return Array.from(
      { length: parameter.payloadWords },
      (_, index) => `${subject}.setPayloadWordAt(${firstWord + index}, decoder.next());`,
    );
  }
  if (kind.tag === "Scalar" && twoWordScalars.has(kind.scalar))
    return [`${subject}.setPayloadWordPairAt(${firstWord}, decoder.nextPair());`];
  return [`${subject}.setPayloadWordAt(${firstWord}, ${nextWordFunction(kind, parameter.isOptional)}(decoder));`];
}

function checkedFixedWord(kind: Kind, isOptional: boolean, word: string): string | null {
  const type = engineTypeOf(kind);
  if (kind.tag === "Id" && !kind.id.isEngine)
    return `decoder.${isOptional ? "checkedOptionalID" : "checkedID"}<${type}>(${word}, isValid)`;
  if (kind.tag === "External") return null;
  if (kind.tag === "Enum")
    return `${isOptional ? "checkedOptionalEnumerator" : "checkedEnumerator"}<${type}>(${word}, isValid)`;
  if (kind.tag === "Flags") return `checkedFlagWord<${kind.type.name}>(${word}, isValid)`;
  if (kind.tag === "Scalar" && kind.scalar === "Bool") return `checkedBoolean(${word}, isValid)`;
  return word;
}

interface FixedWords {
  readonly count: number;
  readonly statements: readonly string[];
}

function fixedWordsOfPayload(parameter: PayloadField, subject: string, first: number): FixedWords | null {
  const kind = parameter.kind;
  const firstWord = parameter.firstWord;
  if (kind.tag === "List" || firstWord === null) return null;
  if (isNested(kind)) {
    if (!isWireType(kind)) {
      const statements = Array.from(
        { length: parameter.payloadWords },
        (_, index) => `${subject}.setPayloadWordAt(${firstWord + index}, words[${first + index}]);`,
      );
      return { count: parameter.payloadWords, statements };
    }
    if (nameOf(kind) !== "DeclaredType") return null;
    return {
      count: 3,
      statements: [`setCheckedDeclaredType(decoder, ${subject}, ${firstWord}, words + ${first}, isValid);`],
    };
  }
  if (kind.tag === "Scalar" && twoWordScalars.has(kind.scalar)) {
    return {
      count: 2,
      statements: [
        `${subject}.setPayloadWordAt(${firstWord}, words[${first}]);`,
        `${subject}.setPayloadWordAt(${firstWord + 1}, words[${first + 1}]);`,
      ],
    };
  }
  const word = checkedFixedWord(kind, parameter.isOptional, `words[${first}]`);
  return word === null ? null : { count: 1, statements: [`${subject}.setPayloadWordAt(${firstWord}, ${word});`] };
}

function decodeFixedWords(entry: Entry, subject: string): string[] {
  const statements: string[] = [];
  let count = 0;
  for (const parameter of wireParametersOf(entry)) {
    if (parameter.tag === "Operand") {
      if (parameter.isVariadic) return [];
      statements.push(
        `${subject}.setOperand(${parameter.index}, decoder.${parameter.isOptional ? "checkedOptionalOperand" : "checkedOperand"}(words[${count}], isValid));`,
      );
      count += 1;
      continue;
    }
    const fixed = fixedWordsOfPayload(parameter, subject, count);
    if (fixed === null) return [];
    statements.push(...fixed.statements);
    count += fixed.count;
  }
  if (count === 0) return [];
  return [
    `if (const uint32_t* words = decoder.peekWords(${count})) {`,
    "    bool isValid = true;",
    ...indent(statements),
    "    if (isValid) [[likely]] {",
    `        decoder.skipWords(${count});`,
    "        return;",
    "    }",
    "}",
  ];
}

function decodeEntry(entry: Entry, subject: string): string[] {
  const statements = wireParametersOf(entry).flatMap(parameter => {
    if (parameter.tag === "Payload") return decodePayload(entry, parameter, subject);
    if (parameter.isVariadic) return [`decoder.decodeVariadicOperands(${subject});`];
    return [
      `${subject}.setOperand(${parameter.index}, decoder.${parameter.isOptional ? "nextOptionalOperand" : "nextOperand"}());`,
    ];
  });
  return [...decodeFixedWords(entry, subject), ...statements, "return;"];
}

function decodeFunction(
  entries: readonly Entry[],
  typeName: string,
  subject: string,
  tag: string,
  enumName: string,
): string[] {
  return [
    `void decodeFields(BodyDecoder& decoder, ${typeName}& ${subject})`,
    "{",
    `    switch (${subject}.${tag}) {`,
    ...groupedCases(
      enumName,
      entries.map(entry => ({ label: entry.name, body: decodeEntry(entry, subject) })),
    ),
    "    }",
    "    RELEASE_ASSERT_NOT_REACHED();",
    "}",
  ];
}

function bodyDecoderSource(schema: Schema): string[] {
  return cppSource(
    ['"AOTReaderInternal.h"', "<array>", "<bit>"],
    inNamespace("Typed", [
      ...decoderHelpers,
      "",
      ...decodeFunction(schema.operations, "Value", "value", "opcode", "Opcode"),
      "",
      ...decodeFunction(schema.terminators, "Terminator", "terminator", "kind", "TerminatorKind"),
    ]),
  );
}

export function emitCppReader(context: EmitContext): OutputFile[] {
  return [
    { name: "AOTSchemaReader.h", lines: readerHeader(context.schema) },
    { name: "AOTSchemaRecordReader.cpp", lines: recordReaderSource(context.schema) },
    { name: "AOTSchemaBodyDecoder.cpp", lines: bodyDecoderSource(context.schema) },
  ];
}
