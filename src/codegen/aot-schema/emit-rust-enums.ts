import { blocks, braced, delimited, indentation, rustMarker, withCommas } from "./lines.ts";
import type { ColumnKind, ColumnValue, EnumColumn, Schema, SchemaEnum } from "./model.ts";
import { wireMembersOf } from "./model.ts";
import { rustIdentifier, rustTypeName, screamingCase } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { rustColumnTypeOf, rustLiteral } from "./rust-types.ts";

const denseEnumDerives = "#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug, Default)]";

function columnType(schema: Schema, kind: ColumnKind): string {
  return rustColumnTypeOf(kind);
}

function columnValue(schema: Schema, kind: ColumnKind, value: ColumnValue): string {
  switch (value.tag) {
    case "Bool":
      return value.value ? "true" : "false";
    case "Integer":
      return value.value.toString();
    case "Text":
      return rustLiteral(value.value);
    case "Member":
      return `${columnType(schema, kind)}::${value.member.name}`;
    case "Members": {
      const type = columnType(schema, kind);
      const bits = value.members.map(member => `${type}::${screamingCase(member.name)}.0`);
      return `${type}(${bits.length === 0 ? "0" : bits.join(" | ")})`;
    }
  }
}

export function denseEnum(
  schema: Schema,
  name: string,
  members: readonly string[],
  columns: readonly EnumColumn[] = [],
  values: readonly (readonly ColumnValue[])[] = [],
  rep = "u32",
): string[] {
  const type = rustTypeName(name);
  const count = members.length;
  const declarations = members.map((member, number) =>
    number === 0 ? `#[default] ${member} = 0` : `${member} = ${number}`,
  );
  const lines = [
    `#[repr(${rep})]`,
    denseEnumDerives,
    ...braced(`pub enum ${type}`, declarations, "}"),
    `impl ${type} {`,
    `${indentation}pub const COUNT: usize = ${count};`,
    ...delimited(
      `pub const ALL: [${type}; ${count}] = [`,
      withCommas(members.map(member => `${type}::${member}`)),
      "];",
      indentation,
    ),
    ...delimited(
      `pub const NAMES: [&'static str; ${count}] = [`,
      withCommas(members.map(rustLiteral)),
      "];",
      indentation,
    ),
  ];
  for (const [position, column] of columns.entries()) {
    if (!column.isInRust) continue;
    const open = `const ${screamingCase(column.name)}: [${columnType(schema, column.kind)}; ${count}] = [`;
    const texts = values.map(memberValues => columnValue(schema, column.kind, memberValues[position]));
    if (column.kind.tag === "Text") {
      lines.push(
        `${indentation}${open}`,
        ...texts.map(text => `${indentation}${indentation}${text},`),
        `${indentation}];`,
      );
    } else {
      lines.push(...delimited(open, withCommas(texts), "];", indentation));
    }
  }
  lines.push(
    `${indentation}pub const fn name(self) -> &'static str { Self::NAMES[self as usize] }`,
    `${indentation}pub fn from_name(name: &str) -> Option<${type}> { Self::ALL.into_iter().find(|member| member.name() == name) }`,
    `${indentation}pub const fn to_wire(self) -> u32 { self as u32 }`,
    `${indentation}pub const fn from_wire(word: u32) -> Option<${type}> { if (word as usize) < Self::COUNT { Some(Self::ALL[word as usize]) } else { None } }`,
  );
  for (const column of columns) {
    if (!column.isInRust) continue;
    const signature = `pub const fn ${rustIdentifier(column.name)}(self) -> ${columnType(schema, column.kind)}`;
    lines.push(`${indentation}${signature} { Self::${screamingCase(column.name)}[self as usize] }`);
  }
  lines.push("}");
  return lines;
}

export function enumBlock(schema: Schema, type: SchemaEnum): string[] {
  const members = wireMembersOf(type);
  return denseEnum(
    schema,
    type.name,
    members.map(member => member.name),
    type.columns,
    members.map(member => member.values),
  );
}

export function flagWord(type: SchemaEnum): string[] {
  const name = rustTypeName(type.name);
  const members = wireMembersOf(type).map(member => member.name);
  return [
    "#[repr(transparent)]",
    "#[derive(Copy, Clone, PartialEq, Eq, Hash, Default, Debug)]",
    `pub struct ${name}(pub u32);`,
    `impl ${name} {`,
    ...members.map(
      (member, bit) => `${indentation}pub const ${screamingCase(member)}: ${name} = ${name}(1 << ${bit});`,
    ),
    `${indentation}pub const ALL: ${name} = ${name}(0b${"1".repeat(members.length)});`,
    ...delimited(
      `pub const NAMES: [&'static str; ${members.length}] = [`,
      withCommas(members.map(rustLiteral)),
      "];",
      indentation,
    ),
    `${indentation}pub const fn contains(self, other: ${name}) -> bool { self.0 & other.0 == other.0 }`,
    `${indentation}pub const fn intersects(self, other: ${name}) -> bool { self.0 & other.0 != 0 }`,
    `${indentation}pub const fn is_empty(self) -> bool { self.0 == 0 }`,
    `${indentation}pub const fn without(self, other: ${name}) -> ${name} { ${name}(self.0 & !other.0) }`,
    `${indentation}pub const fn to_wire(self) -> u32 { self.0 }`,
    `${indentation}pub const fn from_wire(word: u32) -> Option<${name}> { if word & !Self::ALL.0 == 0 { Some(${name}(word)) } else { None } }`,
    "}",
    `impl core::ops::BitOr for ${name} { type Output = ${name}; fn bitor(self, other: ${name}) -> ${name} { ${name}(self.0 | other.0) } }`,
    `impl core::ops::BitOrAssign for ${name} { fn bitor_assign(&mut self, other: ${name}) { self.0 |= other.0; } }`,
    `impl core::ops::BitAnd for ${name} { type Output = ${name}; fn bitand(self, other: ${name}) -> ${name} { ${name}(self.0 & other.0) } }`,
  ];
}

const abiFiles: ReadonlySet<string> = new Set([
  "schema/limits.def",
  "schema/passes.def",
  "schema/statistics.def",
  "schema/diagnostics.def",
  "schema/compile-call.def",
]);

const vocabularyFiles: ReadonlySet<string> = new Set(["AOTSchema.def", "schema/types.def"]);

function enumsRs(schema: Schema, isVocabulary: boolean): string[] {
  const filePosition = (type: SchemaEnum) => schema.files.findIndex(file => file.path === type.file.path);
  const own = [...schema.enums, ...schema.flagWords]
    .filter(type => type.wireMemberCount > 0)
    .filter(type => !type.isAbi || !abiFiles.has(type.file.path))
    .filter(type => vocabularyFiles.has(type.file.path) === isVocabulary)
    .sort((left, right) => filePosition(left) - filePosition(right));
  return [rustMarker, "", ...blocks(...own.map(type => (type.isFlags ? flagWord(type) : enumBlock(schema, type))))];
}

export function emitRustEnums(context: EmitContext): OutputFile[] {
  return [
    { name: "enums.rs", lines: enumsRs(context.schema, true) },
    { name: "program_enums.rs", lines: enumsRs(context.schema, false) },
  ];
}
