import { rawInitializerOf, rawTypeOf, sectionElementTypeOf } from "./cpp-types.ts";
import { blocks, cppHeader, cppSource, inNamespace, indentation, lineWidth, pack } from "./lines.ts";
import type { AbiLayout, Constant, ProgramList, Schema, SchemaRecord, Variant } from "./model.ts";
import { placedWordKinds, recordsOf } from "./model.ts";
import { cppIdTypeName, programListMemberName } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { wireTypesOf } from "./rust-types.ts";

const bytesPerWord = 4;

const placedWordClass = `template<typename Tag>
class PlacedWord {
public:
    constexpr PlacedWord() = default;
    constexpr explicit PlacedWord(uint32_t value)
        : m_value(value)
    {
    }

    constexpr uint32_t value() const { return m_value; }
    friend constexpr bool operator==(PlacedWord, PlacedWord) = default;
    friend constexpr auto operator<=>(PlacedWord, PlacedWord) = default;

private:
    uint32_t m_value { 0 };
};`.split("\n");

const openSectionFunction = `template<typename T>
static bool openSection(std::span<const uint8_t> buffer, const Header& header, ProgramList list, std::span<const T>& result)
{
    const Section& section = header.sections[static_cast<size_t>(list)];
    uint64_t sizeInBytes = static_cast<uint64_t>(section.count) * sizeof(T);
    if (section.offsetInBytes % sizeof(uint32_t) || section.offsetInBytes + sizeInBytes > buffer.size())
        return false;
    result = spanReinterpretCast<const T>(buffer.subspan(section.offsetInBytes, static_cast<size_t>(sizeInBytes)));
    return true;
}`.split("\n");

function idsHeader(schema: Schema): string[] {
  const idTypes = schema.idKinds.map(kind => cppIdTypeName(kind.name));
  return cppHeader(
    ['"AOTID.h"'],
    inNamespace(
      "Typed",
      blocks(
        idTypes.map(type => `using ${type} = ID<struct ${type}Tag>;`),
        placedWordClass,
        placedWordKinds.map(word => `using ${word} = PlacedWord<struct ${word}Tag>;`),
      ),
    ),
  );
}

function layoutOf(record: SchemaRecord): AbiLayout {
  if (record.form === "abi") {
    if (record.abiLayout === null) throw new Error(`abi record ${record.name} has no layout`);
    return record.abiLayout;
  }
  const offsets: number[] = [];
  let size = 0;
  for (const field of record.wireFields) {
    offsets.push(size);
    size += bytesPerWord * field.wireWords;
  }
  return { size, alignment: bytesPerWord, offsets };
}

function layoutAssertion(name: string, size: number, alignment: number): string {
  return `static_assert(sizeof(${name}) == ${size} && alignof(${name}) == ${alignment} && std::is_trivially_copyable_v<${name}>);`;
}

function rawStruct(record: SchemaRecord): string[] {
  const name = record.name;
  const isAbi = record.form === "abi";
  const fields = isAbi ? record.fields : record.wireFields;
  const members = fields.map(
    field => `${rawTypeOf(field, record.form)} ${field.name}${rawInitializerOf(field, record.form)};`,
  );
  const comparison = isAbi
    ? ["", `${indentation}friend bool operator==(const ${name}&, const ${name}&) = default;`]
    : [];
  const oneLine = `struct ${name} { ${members.join(" ")} };`;
  const fitsOneLine = !isAbi && oneLine.length <= lineWidth;
  const definition = fitsOneLine ? [oneLine] : [`struct ${name} {`, ...pack(members, indentation), ...comparison, "};"];
  const layout = layoutOf(record);
  const offsetAssertions = fields.map(
    (field, index) => `static_assert(offsetof(${name}, ${field.name}) == ${layout.offsets[index]});`,
  );
  return [...definition, layoutAssertion(name, layout.size, layout.alignment), ...pack(offsetAssertions, "")];
}

function rawVariant(variant: Variant): string[] {
  return [
    `struct ${variant.name} { uint32_t kind { 0 }; std::array<uint32_t, ${variant.wireWords - 1}> words { }; };`,
    layoutAssertion(variant.name, bytesPerWord * variant.wireWords, bytesPerWord),
  ];
}

function wide(name: string, type: string): string[] {
  return [
    `struct ${name} {`,
    "    uint32_t low { 0 };",
    "    uint32_t high { 0 };",
    `    constexpr ${name}() = default;`,
    `    constexpr ${name}(${type} value)`,
    "        : low(static_cast<uint32_t>(value))",
    "        , high(static_cast<uint32_t>(static_cast<uint64_t>(value) >> 32))",
    "    {",
    "    }",
    `    constexpr operator ${type}() const { return static_cast<${type}>(static_cast<uint64_t>(high) << 32 | low); }`,
    "};",
  ];
}

function constantLine(constant: Constant): string {
  const { name, value } = constant;
  if (value < 0n || value > 0xffffffffn) return `inline constexpr int64_t ${name} = ${value}ll;`;
  return `inline constexpr uint32_t ${name} = ${value > 0xffffn ? `0x${value.toString(16).padStart(8, "0")}` : value};`;
}

function holdsRecords(list: ProgramList): boolean {
  return list.element.tag !== "Scalar";
}

function wireHeader(schema: Schema, hash: bigint): string[] {
  const body = blocks(
    [
      `inline constexpr uint64_t schemaHash = 0x${hash.toString(16).padStart(16, "0")}ull;`,
      "inline constexpr uint32_t none = UINT32_MAX;",
      ...schema.constants.map(constantLine),
      `inline constexpr unsigned numberOfLists = ${schema.lists.length};`,
    ],
    wide("UInt64", "uint64_t"),
    wide("Int64", "int64_t"),
    ["struct Span { uint32_t start { 0 }; uint32_t count { 0 }; };"],
    ...wireTypesOf(schema).map(type => (type.tag === "Record" ? rawStruct(type.record) : rawVariant(type.variant))),
  );
  return cppHeader(
    [
      '"AOTSchemaEnums.h"',
      '"AOTWireRecords.h"',
      "<array>",
      "<cstddef>",
      "<expected>",
      "<span>",
      "<type_traits>",
      "<wtf/StdLibExtras.h>",
      "<wtf/Vector.h>",
    ],
    inNamespace("Wire", body),
  );
}

function wireSectionsHeader(schema: Schema): string[] {
  const lists = schema.lists.map(list => ({
    name: list.name,
    type: sectionElementTypeOf(list.element),
    member: programListMemberName(list.name),
  }));
  const recordLists = schema.lists
    .filter(holdsRecords)
    .map(list => ({ name: list.name, type: sectionElementTypeOf(list.element) }));
  const body = blocks(
    [
      "struct Sections {",
      "    JS_EXPORT_PRIVATE static std::expected<Sections, uint32_t> open(std::span<const uint8_t> buffer, const Header&);",
      "",
      "    template<typename WireRecord> std::span<const WireRecord> listOf() const;",
      "",
      ...lists.map(list => `    std::span<const ${list.type}> ${list.name};`),
      "};",
    ],
    recordLists.map(
      list =>
        `template<> inline std::span<const ${list.type}> Sections::listOf<${list.type}>() const { return ${list.name}; }`,
    ),
    [
      "struct SectionVectors {",
      "    template<typename WireRecord> Vector<WireRecord>& listOf();",
      "    template<typename Functor> void forEachList(const Functor&) const;",
      "",
      ...lists.map(list => `    Vector<${list.type}> ${list.name};`),
      "};",
    ],
    recordLists.map(
      list => `template<> inline Vector<${list.type}>& SectionVectors::listOf<${list.type}>() { return ${list.name}; }`,
    ),
    [
      "template<typename Functor>",
      "void SectionVectors::forEachList(const Functor& functor) const",
      "{",
      ...lists.map(
        list =>
          `    functor(Typed::ProgramList::${list.member}, asByteSpan(${list.name}.span()), static_cast<uint32_t>(${list.name}.size()));`,
      ),
      "}",
    ],
  );
  return cppHeader(
    ['"AOTWire.h"', "<expected>", "<span>", "<wtf/StdLibExtras.h>", "<wtf/Vector.h>"],
    inNamespace("Wire", body),
  );
}

function abiHeader(schema: Schema): string[] {
  const records = recordsOf(schema).filter(record => record.form === "abi");
  return cppHeader(
    ['"AOTSchemaEnums.h"', "<array>", "<cstddef>", "<type_traits>"],
    [
      "namespace JSC { namespace AOT { namespace Wire {",
      "",
      ...blocks(...records.map(rawStruct)),
      "",
      "} // namespace Wire",
      "",
      "namespace Typed {",
      "",
      ...pack(
        records.map(record => `using Wire::${record.name};`),
        "",
      ),
      "",
      "} // namespace Typed",
      "",
      "} } // namespace JSC::AOT",
    ],
  );
}

function openList(list: ProgramList): string[] {
  const member = `ProgramList::${programListMemberName(list.name)}`;
  return [
    `    if (!openSection(buffer, header, ${member}, sections.${list.name}))`,
    `        return std::unexpected(static_cast<uint32_t>(${member}));`,
  ];
}

function wireSource(schema: Schema): string[] {
  const body = blocks(["using Typed::ProgramList;"], openSectionFunction, [
    "std::expected<Sections, uint32_t> Sections::open(std::span<const uint8_t> buffer, const Header& header)",
    "{",
    "    Sections sections;",
    ...schema.lists.flatMap(openList),
    "    return sections;",
    "}",
  ]);
  return cppSource(['"AOTWireSections.h"', "<wtf/StdLibExtras.h>"], inNamespace("Wire", body));
}

export function emitCppWire(context: EmitContext): OutputFile[] {
  return [
    { name: "AOTSchemaIDs.h", lines: idsHeader(context.schema) },
    { name: "AOTWire.h", lines: wireHeader(context.schema, context.hash) },
    { name: "AOTWireRecords.h", lines: abiHeader(context.schema) },
    { name: "AOTWireSections.h", lines: wireSectionsHeader(context.schema) },
    { name: "AOTWire.cpp", lines: wireSource(context.schema) },
  ];
}
