import { edgeStrengths } from "./types.ts";

export type FieldKind =
  | "feature"
  | "strength"
  | "flag"
  | "range"
  | "set"
  | "optionalSet"
  | "removalMethods"
  | "u16"
  | "u32"
  | "group"
  | "optionalGroup"
  | "languageName"
  | "reserved8"
  | "reserved16"
  | { tiles: SectionName };

export type SectionName =
  "edges" | "featureSets" | "setMembers" | "ranges" | "icuPackages" | "icuRuns" | "icuLanguages" | "moduleTexts";

export interface Section {
  /** The record in Rust. Without one, src/trim/table.rs reads the section by hand. */
  record?: string;
  isCopy?: boolean;
  /** `may_follow` in src/trim/table.rs says which records are well formed behind which. */
  hasRule?: boolean;
  malformed: string;
  fields: Readonly<Record<string, FieldKind>>;
}

// In directory order.
export const sections: Readonly<Record<SectionName, Section>> = {
  edges: {
    record: "FeatureEdge",
    isCopy: true,
    hasRule: true,
    malformed: "Edges",
    fields: { from: "feature", to: "feature", strength: "strength", is_followed: "flag" },
  },
  featureSets: { malformed: "FeatureSets", fields: { members: { tiles: "setMembers" } } },
  setMembers: { malformed: "FeatureSets", fields: { feature: "feature" } },
  ranges: {
    record: "RemovableRange",
    isCopy: true,
    malformed: "Ranges",
    fields: { range: "range", set: "set", is_code: "flag", methods: "removalMethods" },
  },
  icuPackages: {
    record: "IcuPackage",
    malformed: "IcuPackages",
    fields: { range: "range", runs: { tiles: "icuRuns" } },
  },
  icuRuns: {
    record: "IcuItemRun",
    isCopy: true,
    hasRule: true,
    malformed: "IcuRuns",
    fields: { first_item: "u32", item_count: "u32", set: "set", locale_group: "optionalGroup" },
  },
  icuLanguages: {
    record: "IcuLanguage",
    isCopy: true,
    hasRule: true,
    malformed: "IcuLanguages",
    fields: { name: "languageName", group: "group", reserved: "reserved16" },
  },
  moduleTexts: {
    record: "ModuleText",
    isCopy: true,
    hasRule: true,
    malformed: "ModuleTexts",
    fields: {
      range: "range",
      module: "u16",
      set: "set",
      readers: "optionalSet",
      methods: "removalMethods",
      reserved: "reserved8",
    },
  },
};

export const sectionNames = Object.keys(sections) as SectionName[];

const widths: Record<Extract<FieldKind, string>, readonly number[]> = {
  feature: [2],
  strength: [1],
  flag: [1],
  range: [4, 4],
  set: [2],
  optionalSet: [2],
  removalMethods: [1],
  u16: [2],
  u32: [4],
  group: [2],
  optionalGroup: [2],
  languageName: [4],
  reserved8: [1],
  reserved16: [2],
};

const widthsOf = (kind: FieldKind) => (typeof kind === "string" ? widths[kind] : [4, 4]);

/** The bytes of each number that the encoder packs into a record. */
export const fieldBytes = (name: SectionName) => Object.values(sections[name].fields).flatMap(widthsOf);
export const recordBytes = (name: SectionName) => fieldBytes(name).reduce((sum, bytes) => sum + bytes, 0);

const snakeCase = (name: string) => name.replace(/[A-Z]/g, letter => "_" + letter.toLowerCase());
const recordOf = (name: SectionName) => sections[name].record!;

function rustTypeOf(kind: FieldKind): string {
  if (typeof kind !== "string") return `Vec<${recordOf(kind.tiles)}>`;
  switch (kind) {
    case "feature":
      return "Feature";
    case "strength":
      return "EdgeStrength";
    case "flag":
      return "bool";
    case "range":
      return "AddressRange";
    case "set":
      return "SetIndex";
    case "optionalSet":
      return "Option<SetIndex>";
    case "u16":
    case "u32":
      return kind;
    case "group":
      return "LocaleGroup";
    case "optionalGroup":
      return "Option<LocaleGroup>";
    case "languageName":
      return "[u8; 4]";
    default:
      throw new Error(`${kind} is no member of a record`);
  }
}

function rustMembers(fields: Section["fields"]): string[] {
  return Object.entries(fields).flatMap(([name, kind]) => {
    if (kind === "reserved8" || kind === "reserved16") return [];
    if (kind === "removalMethods") return ["pub can_be_cut: bool,", "pub can_be_filled: bool,"];
    return [`pub ${name}: ${rustTypeOf(kind)},`];
  });
}

function rustRecords(): string[] {
  const strengths = edgeStrengths.map((name, value) => `${name} = ${value},`);
  const strengthArms = edgeStrengths.map((name, value) => `${value} => Some(EdgeStrength::${name}),`);
  return [
    "#[repr(u8)]",
    "#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]",
    `pub enum EdgeStrength { ${strengths.join(" ")} }`,
    "impl EdgeStrength {",
    `    pub fn from_byte(byte: u8) -> Option<EdgeStrength> { match byte { ${strengthArms.join(" ")} _ => None } }`,
    "}",
    ...sectionNames.flatMap(name => {
      const { record, isCopy, fields } = sections[name];
      if (record === undefined) return [];
      return [
        `#[derive(${isCopy ? "Copy, " : ""}Clone, PartialEq, Eq, Debug)]`,
        `pub struct ${record} { ${rustMembers(fields).join(" ")} }`,
      ];
    }),
  ];
}

function rustDecoder(name: SectionName): string[] {
  const { fields, malformed, hasRule } = sections[name];
  const record = recordOf(name);
  const before: string[] = [];
  const members: string[] = [];
  const setup: string[] = [];
  const after: string[] = [];
  let at = 0;
  for (const [field, kind] of Object.entries(fields)) {
    const u16 = `read_u16(record, ${at})`;
    const orMalformed = (option: string) => `${option}.ok_or(MALFORMED)?`;
    if (typeof kind !== "string") {
      const child = snakeCase(kind.tiles);
      setup.push(`let mut tiles = Tiling::new(context.sections.${child}, ${recordBytes(kind.tiles)});`);
      const tile = orMalformed(`tiles.take(read_u32(record, ${at}), read_u32(record, ${at + 4}))`);
      members.push(`${field}: parse_${child}(${tile}, context)?,`);
      after.push("if !tiles.is_complete() { return Err(MALFORMED); }");
    } else if (kind === "removalMethods") {
      before.push(`let methods = ${orMalformed(`read_removal_methods(record[${at}])`)};`);
      members.push("can_be_cut: methods.can_be_cut,", "can_be_filled: methods.can_be_filled,");
    } else if (kind === "reserved8" || kind === "reserved16") {
      const bytes = widths[kind][0]!;
      before.push(`if record[${at}..${at + bytes}] != [0; ${bytes}] { return Err(MALFORMED); }`);
    } else {
      const previous = "parsed.last().map(|previous: &" + record + "| previous.range)";
      const expressions: Record<typeof kind, string> = {
        feature: `read_feature(${u16}, MALFORMED)?`,
        strength: orMalformed(`EdgeStrength::from_byte(record[${at}])`),
        flag: orMalformed(`read_flag(u32::from(record[${at}]))`),
        range: orMalformed(`read_address_range(context.base_address, &record[${at}..], ${previous})`),
        set: orMalformed(`read_set_index(${u16}, context.sets.len())`),
        optionalSet: `match ${u16}.checked_sub(1) { Some(index) => Some(${orMalformed("read_set_index(index, context.sets.len())")}), None => None }`,
        u16,
        u32: `read_u32(record, ${at})`,
        group: `LocaleGroup(${u16})`,
        optionalGroup: `${u16}.checked_sub(1).map(LocaleGroup)`,
        languageName: orMalformed(`read_language_name(&record[${at}..])`),
      };
      members.push(`${field}: ${expressions[kind]},`);
    }
    at += widthsOf(kind).reduce((sum, bytes) => sum + bytes, 0);
  }
  return [
    `fn parse_${snakeCase(name)}(records: &[u8], context: &Context<'_>) -> Result<Vec<${record}>, TableError> {`,
    `    const MALFORMED: TableError = TableError::Malformed(MalformedTable::${malformed});`,
    `    let mut parsed = Vec::with_capacity(records.len() / ${at});`,
    ...setup.map(line => "    " + line),
    `    for record in records.as_chunks::<${at}>().0 {`,
    ...before.map(line => "        " + line),
    `        let value = ${record} { ${members.join(" ")} };`,
    ...(hasRule ? ["        if !value.may_follow(parsed.last(), context) { return Err(MALFORMED); }"] : []),
    "        parsed.push(value);",
    "    }",
    ...after.map(line => "    " + line),
    "    Ok(parsed)",
    "}",
  ];
}

function rustSections(): string[] {
  const names = sectionNames.map(snakeCase);
  return [
    `struct Sections<'a> { ${names.map(name => `${name}: &'a [u8],`).join(" ")} }`,
    "fn parse_sections(table: &[u8]) -> Result<Sections<'_>, TableError> {",
    "    let mut directory = Directory::new(table);",
    `    Ok(Sections { ${sectionNames.map((name, index) => `${names[index]}: directory.next_section(${recordBytes(name)})?,`).join(" ")} })`,
    "}",
    `pub const TABLE_HEADER_BYTES: usize = ${32 + 8 * sectionNames.length};`,
    `const FEATURE_SET_RECORD_BYTES: usize = ${recordBytes("featureSets")};`,
    `const SET_MEMBER_RECORD_BYTES: usize = ${recordBytes("setMembers")};`,
  ];
}

const macro = (name: string, body: string[]) => [
  "#[macro_export]",
  `macro_rules! ${name} {`,
  "    () => {",
  ...body.map(line => "        " + line),
  "    };",
  "}",
];

/** Two macros: src/trim/model.rs expands the records, src/trim/table.rs what reads them. */
export function rustTableFormat(): string[] {
  const decoded = sectionNames.filter(name => sections[name].record !== undefined);
  return [
    ...macro("trim_table_records", rustRecords()),
    ...macro("trim_table_decoders", [...rustSections(), ...decoded.flatMap(rustDecoder)]),
  ];
}
