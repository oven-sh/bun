import {
  engineRecordNameOf,
  engineStructNameOf,
  engineTypeOf,
  engineTypesInDependencyOrder,
  isEmbeddedInEngineRecords,
  listFirstWord,
} from "./cpp-types.ts";
import {
  blocks,
  cppHeader,
  groupedCases,
  inNamespace,
  indent,
  indentation,
  type CaseBody,
  type Lines,
} from "./lines.ts";
import type { Entry, Field, IdKind, Kind, Member, Schema, SchemaRecord, SchemaType, Variant } from "./model.ts";
import { fieldsOf, functionLocalIdKinds, innermostKindOf, recordsOf, roleEnumNames } from "./model.ts";
import { cppIdTypeName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";

function walkedTypes(schema: Schema): SchemaType[] {
  return engineTypesInDependencyOrder(schema);
}

function embeddedAbiTypes(schema: Schema): SchemaRecord[] {
  return recordsOf(schema).filter(
    record => record.form === "abi" && isEmbeddedInEngineRecords(schema, { tag: "Record", record }),
  );
}

function referenceKinds(schema: Schema): IdKind[] {
  return schema.idKinds.filter(kind => !functionLocalIdKinds.has(kind.name));
}

function referenceKindsWithoutRoles(schema: Schema): IdKind[] {
  return referenceKinds(schema).filter(kind => !roleEnumNames.has(kind.name));
}

function forEachReferenceDeclarations(typeName: string): string[] {
  return [
    `template<typename Visitor> void forEachReference(${typeName}&, Visitor&&);`,
    `template<typename Visitor> void forEachReference(const ${typeName}&, Visitor&&);`,
  ];
}

function walkersHeader(schema: Schema): string[] {
  const declarations = blocks(
    ["Value", "Terminator"].flatMap(forEachReferenceDeclarations),
    walkedTypes(schema).flatMap(type => forEachReferenceDeclarations(engineStructNameOf(type))),
    [
      ...referenceKindsWithoutRoles(schema).map(
        kind =>
          `template<typename Subject, typename Functor> void forEach${kind.name}(const Subject&, const Functor&);`,
      ),
      "template<typename Subject, typename Functor> void forEachFunctionReference(const Subject&, const Functor&);",
      "template<typename Subject, typename Functor> void forEachModuleReference(const Subject&, const Functor&);",
    ],
    [
      "template<typename Visitor> void forEachPlacedWord(const Value&, Visitor&&);",
      "template<typename Visitor> void forEachPlacedWord(const Terminator&, Visitor&&);",
    ],
  );
  return cppHeader(
    ['"AOTIRFunction.h"', '"AOTLayout.h"', "<wtf/Hasher.h>"],
    [...inNamespace("Typed", declarations), "", '#include "AOTSchemaWalkersInlines.h"'],
  );
}

function isReference(kind: Kind): boolean {
  return kind.tag === "Id" && !functionLocalIdKinds.has(kind.id.name);
}

function lastMemberOf(schema: Schema, enumName: string): Member {
  const type = schema.enums.find(candidate => candidate.name === enumName);
  if (type === undefined) throw new Error(`the schema has no enum ${enumName}`);
  return type.members[type.members.length - 1];
}

function roleArgument(schema: Schema, kind: Kind): string {
  if (kind.tag !== "Id") return "";
  const enumName = roleEnumNames.get(kind.id.name);
  if (enumName === undefined) return "";
  return `, ${enumName}::${(kind.role ?? lastMemberOf(schema, enumName)).name}`;
}

function holdsReferences(kind: Kind, seen: Set<SchemaRecord | Variant> = new Set()): boolean {
  const inner = innermostKindOf(kind);
  if (isReference(inner)) return true;
  if (inner.tag !== "Record" && inner.tag !== "Variant") return false;
  const type = inner.tag === "Record" ? inner.record : inner.variant;
  if (seen.has(type)) return false;
  seen.add(type);
  return fieldsOf(inner).some(field => holdsReferences(field.kind, seen));
}

function visitStatement(schema: Schema, kind: Kind, expression: string, isInAbi: boolean): string {
  if (!isReference(kind)) return `walkReferences(${expression}, visitor);`;
  if (isInAbi) return `visitReferenceWord<${engineTypeOf(kind)}>(${expression}, visitor${roleArgument(schema, kind)});`;
  return `visitReference(${expression}, visitor${roleArgument(schema, kind)});`;
}

function walkField(schema: Schema, field: Field, base: string, isInAbi: boolean): string[] {
  const kind = field.kind;
  const isCustomField = kind.tag === "Record" && kind.record.isCustomEngine;
  if (isCustomField || !holdsReferences(kind)) return [];
  const expression = `${base}.${field.name}`;
  const isArray = field.arrayLength !== null || field.isOnePerList;
  const element = kind.tag === "Span" || kind.tag === "List" ? kind.element : isArray ? kind : null;
  if (element === null) return [visitStatement(schema, kind, expression, isInAbi)];
  return [`for (auto& element : ${expression})`, indentation + visitStatement(schema, element, "element", isInAbi)];
}

function bothConstnesses(typeName: string, walkerName: string, isPublic = true): string[] {
  const internal = [
    `template<typename Visitor> void walkReferences(${typeName}& subject, Visitor& visitor) { ${walkerName}(subject, visitor); }`,
    `template<typename Visitor> void walkReferences(const ${typeName}& subject, Visitor& visitor) { ${walkerName}(subject, visitor); }`,
  ];
  if (!isPublic) return internal;
  return [
    ...internal,
    `template<typename Visitor> void forEachReference(${typeName}& subject, Visitor&& visitor) { walkWithoutRoles(subject, visitor); }`,
    `template<typename Visitor> void forEachReference(const ${typeName}& subject, Visitor&& visitor) { walkWithoutRoles(subject, visitor); }`,
  ];
}

function walker(name: string, parameter: string, indentedBody: Lines): string[] {
  const body =
    indentedBody.length > 0 ? indentedBody : indent([`UNUSED_PARAM(${parameter});`, "UNUSED_PARAM(visitor);"]);
  return [
    "template<typename Subject, typename Visitor>",
    `void ${name}(Subject& ${parameter}, Visitor& visitor)`,
    "{",
    ...body,
    "}",
  ];
}

function exhaustiveSwitch(subject: string, enumName: string, cases: readonly CaseBody[]): string[] {
  return [
    ...indent([`switch (${subject}) {`]),
    ...groupedCases(enumName, cases),
    ...indent(["}", "RELEASE_ASSERT_NOT_REACHED();"]),
  ];
}

function recordWalker(schema: Schema, record: SchemaRecord): string[] {
  const isAbi = record.form === "abi";
  const typeName = engineRecordNameOf(record);
  const body = record.fields.flatMap(field => walkField(schema, field, "record", isAbi));
  return [
    ...walker(`walk${typeName}`, "record", indent(body)),
    "",
    ...bothConstnesses(typeName, `walk${typeName}`, !isAbi),
  ];
}

function variantWalker(schema: Schema, variant: Variant): string[] {
  const cases = variant.cases.map(variantCase => {
    const statements = variantCase.fields.flatMap(field => walkField(schema, field, "value", false));
    if (statements.length === 0) return { label: variantCase.name, body: ["return;"] };
    const value = `auto& value = variant.template as<${variant.name}::${variantCase.name}>();`;
    return { label: variantCase.name, body: ["{", ...indent([value, ...statements, "return;"]), "}"] };
  });
  const hasReferences = cases.some(caseBody => caseBody.body.length > 1);
  const body = hasReferences ? exhaustiveSwitch("variant.kind()", `${variant.name}::Kind`, cases) : [];
  return [
    ...walker(`walk${variant.name}`, "variant", body),
    "",
    ...bothConstnesses(variant.name, `walk${variant.name}`),
  ];
}

const helpers = `template<typename Reference, typename Visitor, typename... Role>
void visitReference(Reference& reference, Visitor& visitor, Role... role)
{
    if (reference)
        visitor(reference, role...);
}

template<typename Reference, typename Word, typename Visitor, typename... Role>
void visitReferenceWord(Word& word, Visitor& visitor, Role... role)
{
    Reference reference = decodePayloadWord<Reference>(word);
    if (!reference)
        return;
    visitor(reference, role...);
    if constexpr (!std::is_const_v<Word>)
        word = encodePayloadWord(reference);
}

template<typename Reference, typename Holder, typename Visitor, typename... Role>
void visitPayloadReference(Holder& holder, unsigned word, Visitor& visitor, Role... role)
{
    Reference reference = decodePayloadWord<Reference>(holder.payloadWordAt(word));
    if (!reference)
        return;
    visitor(reference, role...);
    if constexpr (!std::is_const_v<Holder>)
        holder.setPayloadWordAt(word, encodePayloadWord(reference));
}

template<typename Reference, typename Holder, typename Visitor, typename... Role>
void visitPayloadReferenceList(Holder& holder, unsigned firstWord, Visitor& visitor, Role... role)
{
    if constexpr (std::is_const_v<Holder>) {
        for (const uint32_t& word : holder.payloadListFrom(firstWord))
            visitReferenceWord<Reference>(word, visitor, role...);
    } else {
        for (uint32_t& word : holder.mutablePayloadListFrom(firstWord))
            visitReferenceWord<Reference>(word, visitor, role...);
    }
}

template<typename Record, typename Holder, typename Visitor>
void visitPayloadRecord(Holder& holder, unsigned firstWord, Visitor& visitor)
{
    Record record = decodePayloadRecord<Record>(holder, firstWord);
    walkReferences(record, visitor);
    if constexpr (!std::is_const_v<Holder>)
        encodePayloadRecord(holder, firstWord, record);
}

template<typename Record, typename Holder, typename Visitor>
void visitPayloadRecordList(Holder& holder, unsigned firstWord, Visitor& visitor)
{
    constexpr unsigned wordsPerElement = PayloadWords<Record>::count;
    size_t numberOfWords = holder.payloadListFrom(firstWord).size();
    for (size_t offset = 0; offset < numberOfWords; offset += wordsPerElement) {
        Record record = PayloadWords<Record>::decode(holder.payloadListFrom(firstWord).subspan(offset).template first<wordsPerElement>());
        walkReferences(record, visitor);
        if constexpr (!std::is_const_v<Holder>)
            PayloadWords<Record>::encode(record, holder.mutablePayloadListFrom(firstWord).subspan(offset).template first<wordsPerElement>());
    }
}

template<typename Word, typename Holder, typename Visitor>
void visitPlacedWord(const Holder& holder, unsigned word, Visitor& visitor)
{
    if (auto placed = decodePayloadWord<std::optional<Word>>(holder.payloadWordAt(word)))
        visitor(*placed);
}

template<typename Wanted, typename Functor>
struct ReferenceFilter {
    template<typename Reference, typename... Role>
    void operator()(const Reference& reference, Role... role) const
    {
        if constexpr (std::is_same_v<Reference, Wanted>)
            functor(reference, role...);
    }

    const Functor& functor;
};

template<typename Visitor>
struct VisitorWithoutRoles {
    template<typename Reference, typename... Role>
    void operator()(Reference& reference, Role...) const { visitor(reference); }

    Visitor& visitor;
};

template<typename Subject, typename Visitor>
void walkWithoutRoles(Subject& subject, Visitor& visitor)
{
    VisitorWithoutRoles<Visitor> withoutRoles { visitor };
    walkReferences(subject, withoutRoles);
}

template<typename Wanted, typename Subject, typename Functor>
void walkFiltered(const Subject& subject, const Functor& functor)
{
    ReferenceFilter<Wanted, Functor> filter { functor };
    walkReferences(subject, filter);
}`.split("\n");

function walkEntry(schema: Schema, entry: Entry): string[] {
  const statements = entry.payload.flatMap(field => {
    if (!holdsReferences(field.kind)) return [];
    const isList = field.kind.tag === "List";
    const kind = field.kind.tag === "List" ? field.kind.element : field.kind;
    const helper = `visitPayload${isReference(kind) ? "Reference" : "Record"}${isList ? "List" : ""}`;
    return [
      `${helper}<${engineTypeOf(kind)}>(subject, ${isList ? listFirstWord(entry) : field.firstWord}, visitor${roleArgument(schema, kind)});`,
    ];
  });
  return [...statements, "return;"];
}

function placedWordsOfEntry(entry: Entry): string[] {
  const statements = entry.payload.flatMap(field =>
    field.kind.tag === "PlacedWord"
      ? [`visitPlacedWord<${field.kind.word}>(subject, ${field.firstWord}, visitor);`]
      : [],
  );
  return [...statements, "return;"];
}

function entryWalker(
  name: string,
  entries: readonly Entry[],
  tag: string,
  enumName: string,
  bodyOf: (entry: Entry) => Lines,
): string[] {
  const cases = entries.map(entry => ({ label: entry.name, body: bodyOf(entry) }));
  return walker(name, "subject", exhaustiveSwitch(`subject.${tag}`, enumName, cases));
}

function filteredWalk(name: string, idKind: string): string[] {
  return [
    "template<typename Subject, typename Functor>",
    `void ${name}(const Subject& subject, const Functor& functor) { walkFiltered<${cppIdTypeName(idKind)}>(subject, functor); }`,
  ];
}

function walkersInlines(schema: Schema): string[] {
  const abiRecords = embeddedAbiTypes(schema);
  const referencesOf = (entry: Entry) => walkEntry(schema, entry);
  const body = blocks(
    abiRecords.flatMap(record => [
      `template<typename Visitor> void walkReferences(${record.name}&, Visitor&);`,
      `template<typename Visitor> void walkReferences(const ${record.name}&, Visitor&);`,
    ]),
    helpers,
    ...abiRecords.map(record => recordWalker(schema, record)),
    ...walkedTypes(schema).map(type =>
      type.tag === "Record" ? recordWalker(schema, type.record) : variantWalker(schema, type.variant),
    ),
    entryWalker("walkValue", schema.operations, "opcode", "Opcode", referencesOf),
    bothConstnesses("Value", "walkValue"),
    entryWalker("walkTerminator", schema.terminators, "kind", "TerminatorKind", referencesOf),
    bothConstnesses("Terminator", "walkTerminator"),
    referenceKindsWithoutRoles(schema).flatMap(kind => filteredWalk(`forEach${kind.name}`, kind.name)),
    [...filteredWalk("forEachFunctionReference", "Function"), ...filteredWalk("forEachModuleReference", "Module")],
    entryWalker("walkPlacedWordsOfValue", schema.operations, "opcode", "Opcode", placedWordsOfEntry),
    entryWalker("walkPlacedWordsOfTerminator", schema.terminators, "kind", "TerminatorKind", placedWordsOfEntry),
    [
      "template<typename Visitor> void forEachPlacedWord(const Value& value, Visitor&& visitor) { walkPlacedWordsOfValue(value, visitor); }",
      "template<typename Visitor> void forEachPlacedWord(const Terminator& terminator, Visitor&& visitor) { walkPlacedWordsOfTerminator(terminator, visitor); }",
    ],
  );
  return cppHeader(["<type_traits>"], inNamespace("Typed", body));
}

export function emitCppWalkers(context: EmitContext): OutputFile[] {
  return [
    { name: "AOTSchemaWalkers.h", lines: walkersHeader(context.schema) },
    { name: "AOTSchemaWalkersInlines.h", lines: walkersInlines(context.schema) },
  ];
}
