import { groupedArms } from "./emit-rust-references.ts";
import { canBeZero, parseValue } from "./emit-rust-text.ts";
import { kindText } from "./hash.ts";
import { blocks, indent, indentation, rustMarker } from "./lines.ts";
import type { Entry, IdKind, Kind, Parameter, ScalarKind, Schema, SchemaType } from "./model.ts";
import { isId, nameOf, wireFlagsOf, wireParametersOf } from "./model.ts";
import { rustIdTypeName, rustTypeName, snakeCase } from "./names.ts";
import type { EmitContext, OutputFile } from "./outputs.ts";
import { externalPathsOfEntries, idsImport, payloadTypesOf, rustLiteral, rustTypeOf } from "./rust-types.ts";

const entryHelpers = `type PrintWord = fn(&mut Printer<'_>, u32);
type ParseWord = fn(&mut Parser<'_>) -> Parsed<u32>;

const WELL_FORMED: &str = "the fields are those of the entry";

trait PayloadText: Sized {
    const WORDS: usize;
    fn from_words(words: &[u32]) -> Option<Self>;
    fn append_to(&self, words: &mut Vec<u32>);
    fn is_omitted(&self) -> bool;
    fn print(&self, printer: &mut Printer<'_>);
    fn parse(parser: &mut Parser<'_>) -> Parsed<Self>;
}

struct EntryPrinter<'p, 'a> {
    printer: &'p mut Printer<'a>,
    words: &'p [u32],
    at: usize,
    prints_fields: bool,
    operands: SmallVec<[u32; 8]>,
}

impl EntryPrinter<'_, '_> {
    fn next(&mut self) -> u32 {
        let word = self.words[self.at];
        self.at += 1;
        word
    }

    fn next_pair(&mut self) -> u64 {
        let low = self.next() as u64;
        low | (self.next() as u64) << 32
    }

    fn operand(&mut self) {
        let word = self.next();
        if !self.prints_fields {
            self.operands.push(word);
        }
    }

    fn variadic_operands(&mut self) {
        for _ in 0..self.next() {
            self.operand();
        }
    }

    fn begin_field(&mut self, name: &str, is_present: bool) -> bool {
        let prints = self.prints_fields && is_present;
        if prints {
            begin_field(self.printer, &mut true, name);
        }
        prints
    }

    fn always(&mut self, name: &str, print: PrintWord) {
        let word = self.next();
        if self.begin_field(name, true) {
            print(self.printer, word);
        }
    }

    fn unless_absent(&mut self, name: &str, print: PrintWord) {
        let word = self.next();
        if self.begin_field(name, word != ABSENT_WORD) {
            print(self.printer, word);
        }
    }

    fn unless_zero(&mut self, name: &str, print: PrintWord) {
        let word = self.next();
        if self.begin_field(name, word != 0) {
            print(self.printer, word);
        }
    }

    fn name_unless_zero(&mut self, name: &str, names: &[&str]) {
        let word = self.next();
        if self.begin_field(name, word != 0) {
            self.printer.out.push_str(names[word as usize]);
        }
    }

    fn name_unless_absent(&mut self, name: &str, names: &[&str]) {
        let word = self.next();
        if self.begin_field(name, word != ABSENT_WORD) {
            self.printer.out.push_str(names[word as usize]);
        }
    }

    fn flags(&mut self, name: &str, names: &[&str]) {
        let word = self.next();
        if self.begin_field(name, word != 0) {
            print_flags(self.printer, names, word);
        }
    }

    fn integer(&mut self, name: &str) {
        let bits = self.next_pair();
        if self.begin_field(name, bits != 0) {
            print_display(self.printer, bits as i64);
        }
    }

    fn double(&mut self, name: &str) {
        let bits = self.next_pair();
        if self.begin_field(name, bits != 0) {
            self.printer.print_double(f64::from_bits(bits));
        }
    }

    fn record<R: PayloadText>(&mut self, name: &str) {
        let record = R::from_words(&self.words[self.at..]).expect(WELL_FORMED);
        self.at += R::WORDS;
        if self.begin_field(name, !record.is_omitted()) {
            record.print(self.printer);
        }
    }

    fn list(&mut self, name: &str, words_per_element: usize, print_element: impl Fn(&mut Printer<'_>, &[u32])) {
        let count = self.next() as usize;
        let words = self.words;
        let elements = &words[self.at..self.at + count * words_per_element];
        self.at += elements.len();
        if self.begin_field(name, count > 0) {
            self.printer.out.push('[');
            self.printer.print_separated(elements.chunks_exact(words_per_element), |printer, element| print_element(printer, element));
            self.printer.out.push(']');
        }
    }

    fn word_list(&mut self, name: &str, print: PrintWord) {
        self.list(name, 1, |printer, element| print(printer, element[0]));
    }

    fn integer_list(&mut self, name: &str) {
        self.list(name, 2, |printer, element| print_display(printer, (element[0] as u64 | (element[1] as u64) << 32) as i64));
    }

    fn record_list<R: PayloadText>(&mut self, name: &str) {
        self.list(name, R::WORDS, |printer, element| R::from_words(element).expect(WELL_FORMED).print(printer));
    }

    fn print_operands(&mut self) {
        while self.operands.last() == Some(&ABSENT_WORD) {
            self.operands.pop();
        }
        if self.operands.is_empty() {
            return;
        }
        self.printer.out.push(' ');
        let operands = core::mem::take(&mut self.operands);
        self.printer.print_separated(operands, |printer, word| match optional_id_from_word::<ValueId>(word) {
            Some(operand) => print_display(printer, operand),
            None => printer.out.push('-'),
        });
    }
}

fn print_id<I: Id + Display>(printer: &mut Printer<'_>, word: u32) {
    print_display(printer, I::from_word(word));
}

fn print_string(printer: &mut Printer<'_>, word: u32) {
    printer.print_string(StringId::from_word(word));
}

fn print_property_key(printer: &mut Printer<'_>, word: u32) {
    printer.print_property_key(PropertyKeyId::from_word(word));
}

fn print_type(printer: &mut Printer<'_>, word: u32) {
    printer.print_type(TypeId::from_word(word));
}

fn print_number(printer: &mut Printer<'_>, word: u32) {
    print_display(printer, word);
}

fn print_true(printer: &mut Printer<'_>, _word: u32) {
    printer.out.push_str("true");
}

fn print_entry_flags(printer: &mut Printer<'_>, names: &[&str], bits: u32) {
    if bits != 0 {
        printer.out.push(' ');
        print_flags(printer, names, bits);
    }
}

struct EntryParser<'p, 't, 'w> {
    parser: &'p mut Parser<'t>,
    words: &'w mut Vec<u32>,
    operands: SmallVec<[u32; 8]>,
    next_operand: usize,
    field: Option<&'t str>,
}

impl<'p, 't, 'w> EntryParser<'p, 't, 'w> {
    fn new(parser: &'p mut Parser<'t>, words: &'w mut Vec<u32>) -> Parsed<EntryParser<'p, 't, 'w>> {
        let mut operands = SmallVec::new();
        if is_at_operand(parser) {
            loop {
                let operand = parser.parse_optional(|parser| parser.parse_id::<ValueId>("a value"))?;
                operands.push(optional_id_to_word(operand));
                if !parser.accept(TokenKind::Comma) {
                    break;
                }
            }
        }
        let field = parser.next_field_name()?;
        Ok(EntryParser { parser, words, operands, next_operand: 0, field })
    }

    fn operand(&mut self) -> Parsed<()> {
        let word = self.operands.get(self.next_operand).copied().unwrap_or(ABSENT_WORD);
        if word == ABSENT_WORD {
            return self.parser.fail("an operand");
        }
        self.optional_operand();
        Ok(())
    }

    fn optional_operand(&mut self) {
        self.words.push(self.operands.get(self.next_operand).copied().unwrap_or(ABSENT_WORD));
        self.next_operand += 1;
    }

    fn variadic_operands(&mut self) -> Parsed<()> {
        let count = self.operands.len().saturating_sub(self.next_operand);
        self.words.push(count as u32);
        for _ in 0..count {
            self.operand()?;
        }
        Ok(())
    }

    fn accept_field(&mut self, name: &str) -> bool {
        self.field == Some(name)
    }

    fn finish_field(&mut self) -> Parsed<()> {
        self.field = self.parser.next_field_name()?;
        Ok(())
    }

    fn word(&mut self, name: &str, default: u32, parse: ParseWord) -> Parsed<()> {
        if !self.accept_field(name) {
            self.words.push(default);
            return Ok(());
        }
        let word = parse(self.parser)?;
        self.words.push(word);
        self.finish_field()
    }

    fn pair(&mut self, name: &str, parse: fn(&mut Parser<'_>) -> Parsed<u64>) -> Parsed<()> {
        let bits = if self.accept_field(name) { parse(self.parser)? } else { 0 };
        self.words.extend([bits as u32, (bits >> 32) as u32]);
        if self.accept_field(name) { self.finish_field() } else { Ok(()) }
    }

    fn record<R: PayloadText + Default>(&mut self, name: &str) -> Parsed<()> {
        if !self.accept_field(name) {
            R::default().append_to(self.words);
            return Ok(());
        }
        R::parse(self.parser)?.append_to(self.words);
        self.finish_field()
    }

    fn list(&mut self, name: &str, parse_element: impl Fn(&mut Parser<'_>, &mut Vec<u32>) -> Parsed<()>) -> Parsed<()> {
        let count_position = self.words.len();
        self.words.push(0);
        if !self.accept_field(name) {
            return Ok(());
        }
        let words = &mut *self.words;
        let count = self.parser.parse_list(|parser| parse_element(parser, words))?.len();
        self.words[count_position] = count as u32;
        self.finish_field()
    }

    fn word_list(&mut self, name: &str, parse: ParseWord) -> Parsed<()> {
        self.list(name, |parser, words| parse(parser).map(|word| words.push(word)))
    }

    fn integer_list(&mut self, name: &str) -> Parsed<()> {
        self.list(name, |parser, words| parse_integer_bits(parser).map(|bits| words.extend([bits as u32, (bits >> 32) as u32])))
    }

    fn record_list<R: PayloadText>(&mut self, name: &str) -> Parsed<()> {
        self.list(name, |parser, words| R::parse(parser).map(|record| record.append_to(words)))
    }

    fn finish(self, names: &[&str], flags_position: Option<usize>) -> Parsed<()> {
        if self.field.is_some() {
            return self.parser.fail("a field of the entry, in the order of its declaration");
        }
        if self.next_operand < self.operands.len() {
            return self.parser.fail("no more operands than the entry takes");
        }
        if self.parser.at(TokenKind::LeftBracket) {
            let Some(position) = flags_position else {
                return self.parser.fail("no flags: the entry declares none");
            };
            self.words[position] = self.parser.parse_flags(names, "a flag of the entry")?;
        }
        Ok(())
    }
}

fn is_at_operand(parser: &Parser<'_>) -> bool {
    let digits = parser.word_text().and_then(|word| word.strip_prefix(ValueId::PREFIX));
    parser.at(TokenKind::Minus) || digits.is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()))
}

fn parse_id<I: Id>(parser: &mut Parser<'_>) -> Parsed<u32> {
    parser.parse_id::<I>("an id").map(I::to_word)
}

fn parse_string(parser: &mut Parser<'_>) -> Parsed<u32> {
    parser.parse_string().map(StringId::to_word)
}

fn parse_property_key(parser: &mut Parser<'_>) -> Parsed<u32> {
    parser.parse_property_key().map(PropertyKeyId::to_word)
}

fn parse_type(parser: &mut Parser<'_>) -> Parsed<u32> {
    parser.parse_type().map(TypeId::to_word)
}

fn parse_number(parser: &mut Parser<'_>) -> Parsed<u32> {
    parser.parse_u32()
}

fn parse_boolean(parser: &mut Parser<'_>) -> Parsed<u32> {
    parser.parse_bool().map(u32::from)
}

fn parse_integer_bits(parser: &mut Parser<'_>) -> Parsed<u64> {
    parser.parse_i64().map(|value| value as u64)
}

fn parse_double_bits(parser: &mut Parser<'_>) -> Parsed<u64> {
    parser.parse_double().map(f64::to_bits)
}`.split("\n");

function payloadTextImpl(schema: Schema, type: SchemaType): string[] {
  const name = rustTypeName(nameOf(type));
  const form = type.tag === "Record" ? "nested" : "variant";
  return [
    `impl PayloadText for ${name} {`,
    ...indent([
      `const WORDS: usize = ${name}::WORDS;`,
      `fn from_words(words: &[u32]) -> Option<${name}> { ${name}::from_words(words) }`,
      `fn append_to(&self, words: &mut Vec<u32>) { ${name}::append_to(self, words); }`,
      `fn is_omitted(&self) -> bool { ${canBeZero(schema, type) ? "self.is_zero()" : "false"} }`,
      `fn print(&self, printer: &mut Printer<'_>) { self.print_${form}(printer); }`,
      `fn parse(parser: &mut Parser<'_>) -> Parsed<${name}> { ${name}::parse_${form}(parser) }`,
    ]),
    "}",
  ];
}

function idWordFunction(verb: "print" | "parse", id: IdKind): string {
  if (id.record !== null && id.record.isCustomText) return `${verb}_${snakeCase(id.record.name)}`;
  return `${verb}_id::<${rustIdTypeName(id.name)}>`;
}

function isScalar(kind: Kind, scalar: ScalarKind): boolean {
  return kind.tag === "Scalar" && kind.scalar === scalar;
}

function isRecordOrVariant(kind: Kind): boolean {
  return kind.tag === "Record" || kind.tag === "Variant";
}

function throwNotOneWord(kind: Kind): never {
  throw new Error(`${kindText(kind)} has no one-word spelling in the text of an entry`);
}

function printWordFunction(schema: Schema, kind: Kind): string {
  switch (kind.tag) {
    case "Id":
      return idWordFunction("print", kind.id);
    case "External":
      if (!kind.external.isNamedInText) return "print_number";
      return `|printer, word| printer.out.push_str(${rustTypeOf(kind)}::from_wire(word).expect(WELL_FORMED).name())`;
    case "Enum":
      return `|printer, word| printer.out.push_str(${rustTypeOf(kind)}::NAMES[word as usize])`;
    case "Flags":
      return `|printer, word| print_flags(printer, &${rustTypeOf(kind)}::NAMES, word)`;
    case "Scalar":
      if (kind.scalar === "Bool")
        return '|printer, word| printer.out.push_str(if word != 0 { "true" } else { "false" })';
      if (kind.scalar === "UInt32" || kind.scalar === "Field") return "print_number";
      return throwNotOneWord(kind);
    case "PlacedWord":
    case "Record":
    case "Variant":
    case "Span":
    case "List":
      return throwNotOneWord(kind);
  }
}

function parseWordFunction(schema: Schema, kind: Kind): string {
  switch (kind.tag) {
    case "Id":
      return idWordFunction("parse", kind.id);
    case "External":
    case "Enum":
      return `|parser| ${parseValue(schema, kind)}.map(${rustTypeOf(kind)}::to_wire)`;
    case "Flags":
      return `|parser| parser.parse_flags(&${rustTypeOf(kind)}::NAMES, ${rustLiteral(`a member of ${kind.type.name}`)})`;
    case "Scalar":
      if (kind.scalar === "Bool") return "parse_boolean";
      if (kind.scalar === "UInt32" || kind.scalar === "Field") return "parse_number";
      return throwNotOneWord(kind);
    case "PlacedWord":
    case "Record":
    case "Variant":
    case "Span":
    case "List":
      return throwNotOneWord(kind);
  }
}

function printParameter(schema: Schema, parameter: Parameter): string {
  if (parameter.tag === "Operand") return parameter.isVariadic ? "p.variadic_operands();" : "p.operand();";
  const kind = parameter.kind;
  const name = rustLiteral(parameter.name);
  if (kind.tag === "List") {
    if (isRecordOrVariant(kind.element)) return `p.record_list::<${rustTypeOf(kind.element)}>(${name});`;
    if (isScalar(kind.element, "Int64")) return `p.integer_list(${name});`;
    return `p.word_list(${name}, ${printWordFunction(schema, kind.element)});`;
  }
  if (isRecordOrVariant(kind)) return `p.record::<${rustTypeOf(kind)}>(${name});`;
  if (isScalar(kind, "Int64")) return `p.integer(${name});`;
  if (isScalar(kind, "Double")) return `p.double(${name});`;
  if (kind.tag === "Enum")
    return `p.${parameter.isOptional ? "name_unless_absent" : "name_unless_zero"}(${name}, &${rustTypeOf(kind)}::NAMES);`;
  if (parameter.isOptional) return `p.unless_absent(${name}, ${printWordFunction(schema, kind)});`;
  if (kind.tag === "Flags") return `p.flags(${name}, &${rustTypeOf(kind)}::NAMES);`;
  if (isScalar(kind, "Bool")) return `p.unless_zero(${name}, print_true);`;
  return `p.${isId(kind) ? "always" : "unless_zero"}(${name}, ${printWordFunction(schema, kind)});`;
}

function parseParameter(schema: Schema, parameter: Parameter): string {
  if (parameter.tag === "Operand") {
    if (parameter.isVariadic) return "p.variadic_operands()?;";
    return parameter.isOptional ? "p.optional_operand();" : "p.operand()?;";
  }
  const kind = parameter.kind;
  const name = rustLiteral(parameter.name);
  if (kind.tag === "List") {
    if (isRecordOrVariant(kind.element)) return `p.record_list::<${rustTypeOf(kind.element)}>(${name})?;`;
    if (isScalar(kind.element, "Int64")) return `p.integer_list(${name})?;`;
    return `p.word_list(${name}, ${parseWordFunction(schema, kind.element)})?;`;
  }
  if (isRecordOrVariant(kind)) return `p.record::<${rustTypeOf(kind)}>(${name})?;`;
  if (isScalar(kind, "Int64")) return `p.pair(${name}, parse_integer_bits)?;`;
  if (isScalar(kind, "Double")) return `p.pair(${name}, parse_double_bits)?;`;
  return `p.word(${name}, ${parameter.isOptional ? "ABSENT_WORD" : "0"}, ${parseWordFunction(schema, kind)})?;`;
}

function wireFlagNames(entry: Entry): string[] {
  return wireFlagsOf(entry).map(flag => flag.name);
}

function entryTextFunctions(
  schema: Schema,
  enumName: "Opcode" | "TerminatorKind",
  parameter: string,
  suffix: string,
  entries: readonly Entry[],
): string[] {
  const hasFlags = enumName === "Opcode";
  const matchOnEntry = (bodyOf: (entry: Entry) => string[]): string[] => [
    `${indentation}match ${parameter} {`,
    ...groupedArms(
      enumName,
      entries.map(entry => ({ label: entry.name, body: bodyOf(entry) })),
      indentation.repeat(2),
    ),
    `${indentation}}`,
  ];
  const flagNamesFunction = hasFlags
    ? [
        `fn flag_names(${parameter}: ${enumName}) -> &'static [&'static str] {`,
        ...matchOnEntry(entry => [`&[${wireFlagNames(entry).map(rustLiteral).join(", ")}]`]),
        "}",
        "",
      ]
    : [];
  return [
    ...flagNamesFunction,
    `fn print_${suffix}_pass(${parameter}: ${enumName}, p: &mut EntryPrinter<'_, '_>) {`,
    ...matchOnEntry(entry => wireParametersOf(entry).map(wireParameter => printParameter(schema, wireParameter))),
    "}",
    "",
    `pub fn print_${suffix}_fields(${parameter}: ${enumName}, fields: &[u32], printer: &mut Printer<'_>) {`,
    ...indent([
      ...(hasFlags
        ? [`let names = flag_names(${parameter});`, "let first = usize::from(!names.is_empty());"]
        : ["let first = 0;"]),
      "let mut p = EntryPrinter { printer, words: fields, at: first, prints_fields: false, operands: SmallVec::new() };",
      `print_${suffix}_pass(${parameter}, &mut p);`,
      "p.print_operands();",
      "p.at = first;",
      "p.prints_fields = true;",
      `print_${suffix}_pass(${parameter}, &mut p);`,
      ...(hasFlags ? ["if first == 1 {", `${indentation}print_entry_flags(p.printer, names, fields[0]);`, "}"] : []),
    ]),
    "}",
    "",
    `pub fn parse_${suffix}_fields(${parameter}: ${enumName}, parser: &mut Parser<'_>, words: &mut Vec<u32>) -> Parsed<()> {`,
    ...indent(
      hasFlags
        ? [
            `let names = flag_names(${parameter});`,
            "let flags_position = (!names.is_empty()).then_some(words.len());",
            "if flags_position.is_some() {",
            `${indentation}words.push(0);`,
            "}",
          ]
        : [],
    ),
    `${indentation}let mut p = EntryParser::new(parser, words)?;`,
    ...matchOnEntry(entry => wireParametersOf(entry).map(wireParameter => parseParameter(schema, wireParameter))),
    `${indentation}${hasFlags ? "p.finish(names, flags_position)" : "p.finish(&[], None)"}`,
    "}",
  ];
}

function entryTextRs(schema: Schema): string[] {
  const operations = schema.operations.filter(entry => entry.isWire);
  const terminators = schema.terminators.filter(entry => entry.isWire);
  return [
    rustMarker,
    "",
    "use core::fmt::Display;",
    "",
    "use smallvec::SmallVec;",
    "",
    "use super::entries::{Opcode, TerminatorKind};",
    "use super::enums::*;",
    "use super::program_enums::*;",
    "use super::record_text::{begin_field, parse_external, print_display, print_flags};",
    "use super::records::*;",
    ...externalPathsOfEntries([...operations, ...terminators]).map(externalPath => `use ${externalPath};`),
    idsImport,
    "use crate::ir::print::Printer;",
    "use crate::ir::text::{Parsed, Parser};",
    "use crate::ir::text_lexer::TokenKind;",
    "",
    ...entryHelpers,
    "",
    ...blocks(...payloadTypesOf(schema).map(type => payloadTextImpl(schema, type))),
    "",
    ...entryTextFunctions(schema, "Opcode", "opcode", "value", operations),
    "",
    ...entryTextFunctions(schema, "TerminatorKind", "kind", "terminator", terminators),
  ];
}

export function emitRustEntryText(context: EmitContext): OutputFile[] {
  return [{ name: "entry_text.rs", lines: entryTextRs(context.schema) }];
}
