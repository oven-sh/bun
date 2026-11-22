//! <https://protobuf.dev/reference/protobuf/proto3-spec/>, and the specs of proto2 and editions beside it.

use core::ops::RangeInclusive;
use std::collections::BTreeSet;

use crate::lexer::{Lexer, Token};
use crate::schema::*;
use crate::{Failure, Span};

const MAX_FIELD_NUMBER: i64 = (1 << 29) - 1;
const NUMBERS_OF_IMPLEMENTATION: RangeInclusive<i64> = 19000..=19999;
const MAX_NESTING: usize = 64;

type Result<T> = core::result::Result<T, Failure>;

pub(crate) fn parse(text: &[u8]) -> Result<File> {
    let mut parser = Parser {
        lexer: Lexer::new(text)?,
        syntax: Syntax::Proto2,
        nesting: 0,
    };
    parser.file()
}

struct Parser<'a> {
    lexer: Lexer<'a>,
    syntax: Syntax,
    nesting: usize,
}

#[derive(Default)]
struct Options {
    features: Features,
    default: Option<Constant>,
    is_deprecated: bool,
    allows_aliases: bool,
}

#[derive(Default)]
struct Reserved {
    numbers: Vec<RangeInclusive<i64>>,
    names: BTreeSet<String>,
}

impl Reserved {
    fn check(&self, name: &Name, number: i64, number_span: Span) -> Result<()> {
        if self.names.contains(&name.text) {
            let message = format!("The name \"{}\" is reserved", name.text);
            return Err(Failure::new(name.span, message));
        }
        if self.numbers.iter().any(|range| range.contains(&number)) {
            let message = format!("The number {number} is reserved");
            return Err(Failure::new(number_span, message));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FieldPlace {
    Message,
    Oneof(usize),
}

fn parse_integer(text: &str) -> Option<u64> {
    match text.as_bytes() {
        [b'0', b'x' | b'X', ..] => u64::from_str_radix(&text[2..], 16).ok(),
        [b'0', _, ..] => u64::from_str_radix(&text[1..], 8).ok(),
        _ => text.parse().ok(),
    }
}

fn check_unique<'n>(names: impl Iterator<Item = &'n Name>) -> Result<()> {
    let mut seen = BTreeSet::new();
    for name in names {
        if !seen.insert(name.text.as_str()) {
            let message = format!("\"{}\" is already defined", name.text);
            return Err(Failure::new(name.span, message));
        }
    }
    Ok(())
}

impl<'a> Parser<'a> {
    fn unexpected<T>(&self, expected: &str) -> Result<T> {
        let message = match &self.lexer.token {
            Token::Identifier(text) | Token::Integer(text) | Token::Float(text) => {
                format!("Expected {expected} but found \"{text}\"")
            }
            Token::String(_) => format!("Expected {expected} but found a string"),
            Token::Symbol(byte) => {
                format!("Expected {expected} but found \"{}\"", char::from(*byte))
            }
            Token::End => format!("Expected {expected} but found end of file"),
        };
        Err(Failure::new(self.lexer.span, message))
    }

    fn eat(&mut self, symbol: u8) -> Result<bool> {
        let is_next = self.lexer.token == Token::Symbol(symbol);
        if is_next {
            self.lexer.advance()?;
        }
        Ok(is_next)
    }

    fn expect(&mut self, symbol: u8) -> Result<()> {
        match self.eat(symbol)? {
            true => Ok(()),
            false => self.unexpected(&format!("\"{}\"", char::from(symbol))),
        }
    }

    fn eat_keyword(&mut self, keyword: &str) -> Result<bool> {
        let is_next = self.lexer.token == Token::Identifier(keyword);
        if is_next {
            self.lexer.advance()?;
        }
        Ok(is_next)
    }

    fn keyword(&self) -> &'a str {
        match self.lexer.token {
            Token::Identifier(text) => text,
            _ => "",
        }
    }

    fn identifier(&mut self) -> Result<Name> {
        let Token::Identifier(text) = self.lexer.token else {
            return self.unexpected("a name");
        };
        let name = Name {
            text: text.to_owned(),
            span: self.lexer.span,
        };
        self.lexer.advance()?;
        Ok(name)
    }

    fn dotted_rest(&mut self, mut name: Name) -> Result<Name> {
        while self.eat(b'.')? {
            let part = self.identifier()?;
            name.text.push('.');
            name.text.push_str(&part.text);
            name.span.len = part.span.start + part.span.len - name.span.start;
        }
        Ok(name)
    }

    fn type_name(&mut self) -> Result<Name> {
        let first = match self.lexer.token {
            Token::Symbol(b'.') => Name {
                text: String::new(),
                span: self.lexer.span,
            },
            Token::Identifier(_) => self.identifier()?,
            _ => return self.unexpected("a type"),
        };
        self.dotted_rest(first)
    }

    fn string(&mut self) -> Result<Vec<u8>> {
        if !matches!(self.lexer.token, Token::String(_)) {
            return self.unexpected("a string");
        }
        let mut value = Vec::new();
        while let Token::String(part) = &self.lexer.token {
            value.extend_from_slice(part);
            self.lexer.advance()?;
        }
        Ok(value)
    }

    fn utf8_string(&mut self) -> Result<Name> {
        let span = self.lexer.span;
        match core::str::from_utf8(&self.string()?) {
            Ok(text) => Ok(Name {
                text: text.to_owned(),
                span,
            }),
            Err(_) => Err(Failure::new(span, "This string is not valid UTF-8")),
        }
    }

    fn integer_in(&mut self, range: RangeInclusive<i64>) -> Result<(i64, Span)> {
        let start = self.lexer.span.start;
        let is_negative = self.eat(b'-')?;
        let Token::Integer(text) = self.lexer.token else {
            return self.unexpected("an integer");
        };
        let span = Span {
            start,
            len: self.lexer.span.start + self.lexer.span.len - start,
        };
        let value = parse_integer(text).and_then(|value| i64::try_from(value).ok());
        let value = value.map(|value| if is_negative { -value } else { value });
        let Some(value) = value.filter(|value| range.contains(value)) else {
            let (least, most) = range.into_inner();
            let message = format!("Expected an integer from {least} to {most}");
            return Err(Failure::new(span, message));
        };
        self.lexer.advance()?;
        Ok((value, span))
    }

    fn doc(&self) -> Doc {
        let lines = (self.lexer.comment.iter()).map(|line| core::str::from_utf8(line).ok());
        let lines = lines.map(|line| line.map(|line| line.trim_end().to_owned()));
        let mut lines: Vec<String> = lines.collect::<Option<_>>().unwrap_or_default();
        while lines.last().is_some_and(String::is_empty) {
            lines.pop();
        }
        let blank = lines.iter().take_while(|line| line.is_empty()).count();
        lines.drain(..blank);
        Doc {
            lines,
            is_deprecated: false,
        }
    }

    fn file(&mut self) -> Result<File> {
        self.syntax_statement()?;
        let mut package: Option<Name> = None;
        let mut imports = Vec::new();
        let mut options = Options::default();
        let mut types = Types::default();
        let mut services = Vec::new();
        while self.lexer.token != Token::End {
            if self.eat(b';')? || self.type_declaration(&mut types)? {
                continue;
            }
            match self.keyword() {
                "package" => {
                    if package.is_some() {
                        let message = "A file can only have one package";
                        return Err(Failure::new(self.lexer.span, message));
                    }
                    self.lexer.advance()?;
                    let first = self.identifier()?;
                    package = Some(self.dotted_rest(first)?);
                    self.expect(b';')?;
                }
                "import" => {
                    self.lexer.advance()?;
                    let modifier = self.keyword();
                    if matches!(modifier, "public" | "weak" | "option") {
                        self.lexer.advance()?;
                    }
                    let path = self.utf8_string()?;
                    self.expect(b';')?;
                    if modifier != "option" {
                        let is_public = modifier == "public";
                        imports.push(Import { path, is_public });
                    }
                }
                "option" => self.option_statement(&mut options)?,
                "service" => services.push(self.service()?),
                _ => return self.unexpected("a message, enum or service"),
            }
        }
        Ok(File {
            package: package.map_or_else(String::new, |name| name.text),
            imports,
            features: (options.features).inside(Features::defaults_of(self.syntax)),
            types,
            services,
        })
    }

    fn syntax_statement(&mut self) -> Result<()> {
        let keyword = self.keyword();
        if !matches!(keyword, "syntax" | "edition") {
            return Ok(());
        }
        self.lexer.advance()?;
        self.expect(b'=')?;
        let version = self.utf8_string()?;
        self.syntax = match (keyword, version.text.as_str()) {
            ("syntax", "proto2") => Syntax::Proto2,
            ("syntax", "proto3") => Syntax::Proto3,
            ("edition", "2023" | "2024") => Syntax::Editions,
            (_, found) => {
                let supported = match keyword {
                    "syntax" => "\"proto2\" or \"proto3\"",
                    _ => "\"2023\" or \"2024\"",
                };
                let message = format!("Unsupported {keyword} \"{found}\", expected {supported}");
                return Err(Failure::new(version.span, message));
            }
        };
        self.expect(b';')
    }

    /// False if no message, enum or extension is next.
    fn type_declaration(&mut self, types: &mut Types) -> Result<bool> {
        let doc = self.doc();
        if self.syntax == Syntax::Editions && matches!(self.keyword(), "export" | "local") {
            let mut ahead = self.lexer.clone();
            ahead.advance()?;
            if matches!(ahead.token, Token::Identifier("message" | "enum")) {
                self.lexer = ahead;
            }
        }
        match self.keyword() {
            "message" => {
                self.lexer.advance()?;
                let name = self.identifier()?;
                let message = self.message_body(name, doc)?;
                types.messages.push(message);
            }
            "enum" => types.enums.push(self.r#enum(doc)?),
            "extend" => {
                self.lexer.advance()?;
                self.type_name()?;
                self.expect(b'{')?;
                while !self.eat(b'}')? {
                    if !self.eat(b';')? {
                        self.field(FieldPlace::Message, types)?;
                    }
                }
            }
            _ => return Ok(false),
        }
        Ok(true)
    }

    fn message_body(&mut self, name: Name, mut doc: Doc) -> Result<Message> {
        self.nesting += 1;
        if self.nesting > MAX_NESTING {
            let message = format!("Messages cannot be nested more than {MAX_NESTING} levels deep");
            return Err(Failure::new(name.span, message));
        }
        let mut options = Options::default();
        let mut reserved = Reserved::default();
        let mut fields = Vec::new();
        let mut oneofs = Vec::new();
        let mut nested = Types::default();
        self.expect(b'{')?;
        while !self.eat(b'}')? {
            if self.eat(b';')? || self.type_declaration(&mut nested)? {
                continue;
            }
            match self.keyword() {
                "option" => self.option_statement(&mut options)?,
                "reserved" => self.reserved(&mut reserved, 1..=MAX_FIELD_NUMBER)?,
                "extensions" => {
                    self.lexer.advance()?;
                    self.ranges(1..=i64::from(i32::MAX))?;
                    self.bracketed_options()?;
                    self.expect(b';')?;
                }
                "oneof" => oneofs.push(self.oneof(oneofs.len(), &mut fields, &mut nested)?),
                _ => fields.push(self.field(FieldPlace::Message, &mut nested)?),
            }
        }
        self.nesting -= 1;

        let oneof_names = oneofs.iter().map(|oneof| &oneof.name);
        check_unique(fields.iter().map(|field| &field.name).chain(oneof_names))?;
        let mut numbers = BTreeSet::new();
        for field in &fields {
            reserved.check(&field.name, i64::from(field.number), field.number_span)?;
            if !numbers.insert(field.number) {
                let message = format!("Another field has the number {}", field.number);
                return Err(Failure::new(field.number_span, message));
            }
        }
        doc.is_deprecated = options.is_deprecated;
        Ok(Message {
            name,
            doc,
            features: options.features,
            fields,
            oneofs,
            nested,
        })
    }

    fn oneof(
        &mut self,
        index: usize,
        fields: &mut Vec<Field>,
        nested: &mut Types,
    ) -> Result<Oneof> {
        let doc = self.doc();
        self.lexer.advance()?;
        let name = self.identifier()?;
        let mut options = Options::default();
        let fields_before = fields.len();
        self.expect(b'{')?;
        while !self.eat(b'}')? {
            if self.eat(b';')? {
                continue;
            }
            match self.keyword() {
                "option" => self.option_statement(&mut options)?,
                _ => fields.push(self.field(FieldPlace::Oneof(index), nested)?),
            }
        }
        if fields.len() == fields_before {
            let message = "A oneof must have at least one field";
            return Err(Failure::new(name.span, message));
        }
        Ok(Oneof {
            name,
            doc,
            features: options.features,
        })
    }

    fn field(&mut self, place: FieldPlace, nested: &mut Types) -> Result<Field> {
        let mut doc = self.doc();
        let label_span = self.lexer.span;
        let label = match self.keyword() {
            label @ ("optional" | "required" | "repeated") => {
                self.lexer.advance()?;
                label
            }
            _ => "",
        };
        let refusal = match (label, self.syntax, place) {
            ("", ..) => None,
            (_, _, FieldPlace::Oneof(_)) => Some("A field of a oneof cannot have a label"),
            ("required", Syntax::Proto3, _) => Some("proto3 has no required fields"),
            ("optional" | "required", Syntax::Editions, _) => {
                Some("Editions replace this label with \"features.field_presence\"")
            }
            _ => None,
        };
        if let Some(refusal) = refusal {
            return Err(Failure::new(label_span, refusal));
        }

        let mut cardinality = match label {
            "repeated" => Cardinality::Repeated,
            _ => Cardinality::Single,
        };
        let mut type_name = self.type_name()?;
        if type_name.text == "map" && self.eat(b'<')? {
            if !label.is_empty() || place != FieldPlace::Message {
                let message = "A map cannot have a label or be in a oneof";
                return Err(Failure::new(label_span, message));
            }
            let key_name = self.type_name()?;
            let key = Scalar::from_name(&key_name.text)
                .filter(|key| !matches!(key, Scalar::Double | Scalar::Float | Scalar::Bytes));
            let Some(key) = key else {
                let message = "The key of a map must be an integer, a bool or a string";
                return Err(Failure::new(key_name.span, message));
            };
            cardinality = Cardinality::Map { key };
            self.expect(b',')?;
            type_name = self.type_name()?;
            self.expect(b'>')?;
        } else if label.is_empty() && self.syntax == Syntax::Proto2 && place == FieldPlace::Message
        {
            let message = "Expected \"required\", \"optional\" or \"repeated\". A file without a \"syntax\" statement is proto2";
            return Err(Failure::new(label_span, message));
        }
        let is_group = type_name.text == "group" && self.syntax == Syntax::Proto2;

        let mut name = self.identifier()?;
        self.expect(b'=')?;
        let (number, number_span) = self.integer_in(1..=MAX_FIELD_NUMBER)?;
        if NUMBERS_OF_IMPLEMENTATION.contains(&number) {
            let message = "The numbers from 19000 to 19999 are reserved for protobuf itself";
            return Err(Failure::new(number_span, message));
        }
        let mut options = self.bracketed_options()?;
        if is_group {
            let message = self.message_body(name.clone(), Doc::default())?;
            nested.messages.push(message);
            type_name = name.clone();
            name.text.make_ascii_lowercase();
            options.features.is_delimited = Some(true);
        } else {
            self.expect(b';')?;
        }
        match label {
            "optional" => options.features.presence = Some(Presence::Explicit),
            "required" => options.features.presence = Some(Presence::Required),
            _ => {}
        }
        if let Some(default) = &options.default
            && self.syntax == Syntax::Proto3
        {
            return Err(Failure::new(default.span, "proto3 has no default values"));
        }
        doc.is_deprecated = options.is_deprecated;
        Ok(Field {
            name,
            doc,
            number: number as u32,
            number_span,
            cardinality,
            r#type: match Scalar::from_name(&type_name.text) {
                Some(scalar) => FieldType::Scalar(scalar),
                None => FieldType::Named(type_name),
            },
            oneof: match place {
                FieldPlace::Message => None,
                FieldPlace::Oneof(index) => Some(index),
            },
            default: options.default,
            features: options.features,
        })
    }

    fn ranges(&mut self, allowed: RangeInclusive<i64>) -> Result<Vec<RangeInclusive<i64>>> {
        let mut ranges = Vec::new();
        loop {
            let (start, _) = self.integer_in(allowed.clone())?;
            let end = match self.eat_keyword("to")? {
                false => start,
                true if self.eat_keyword("max")? => *allowed.end(),
                true => self.integer_in(start..=*allowed.end())?.0,
            };
            ranges.push(start..=end);
            if !self.eat(b',')? {
                return Ok(ranges);
            }
        }
    }

    fn reserved(&mut self, reserved: &mut Reserved, allowed: RangeInclusive<i64>) -> Result<()> {
        self.lexer.advance()?;
        if matches!(self.lexer.token, Token::Integer(_) | Token::Symbol(b'-')) {
            reserved.numbers.extend(self.ranges(allowed)?);
            return self.expect(b';');
        }
        loop {
            let name = match self.lexer.token {
                Token::Identifier(_) => self.identifier()?,
                _ => self.utf8_string()?,
            };
            reserved.names.insert(name.text);
            if !self.eat(b',')? {
                return self.expect(b';');
            }
        }
    }

    fn r#enum(&mut self, mut doc: Doc) -> Result<Enum> {
        const NUMBERS: RangeInclusive<i64> = i32::MIN as i64..=i32::MAX as i64;
        self.lexer.advance()?;
        let name = self.identifier()?;
        let mut options = Options::default();
        let mut reserved = Reserved::default();
        let mut values = Vec::new();
        let mut number_spans = Vec::new();
        self.expect(b'{')?;
        while !self.eat(b'}')? {
            if self.eat(b';')? {
                continue;
            }
            match self.keyword() {
                "option" => self.option_statement(&mut options)?,
                "reserved" => self.reserved(&mut reserved, NUMBERS)?,
                _ => {
                    let mut doc = self.doc();
                    let name = self.identifier()?;
                    self.expect(b'=')?;
                    let (number, number_span) = self.integer_in(NUMBERS)?;
                    doc.is_deprecated = self.bracketed_options()?.is_deprecated;
                    self.expect(b';')?;
                    number_spans.push(number_span);
                    values.push(EnumValue {
                        name,
                        doc,
                        number: number as i32,
                    });
                }
            }
        }
        if values.is_empty() {
            let message = "An enum must have at least one value";
            return Err(Failure::new(name.span, message));
        }
        check_unique(values.iter().map(|value| &value.name))?;
        let mut numbers = BTreeSet::new();
        for (value, &span) in values.iter().zip(&number_spans) {
            reserved.check(&value.name, i64::from(value.number), span)?;
            if !numbers.insert(value.number) && !options.allows_aliases {
                let message = format!(
                    "Another value has the number {}. To allow that, add \"option allow_alias = true;\"",
                    value.number
                );
                return Err(Failure::new(span, message));
            }
        }
        doc.is_deprecated = options.is_deprecated;
        Ok(Enum {
            name,
            doc,
            features: options.features,
            values,
        })
    }

    fn service(&mut self) -> Result<Service> {
        let mut doc = self.doc();
        self.lexer.advance()?;
        let name = self.identifier()?;
        let mut options = Options::default();
        let mut methods = Vec::new();
        self.expect(b'{')?;
        while !self.eat(b'}')? {
            if self.eat(b';')? {
                continue;
            }
            match self.keyword() {
                "option" => self.option_statement(&mut options)?,
                "rpc" => methods.push(self.method()?),
                _ => return self.unexpected("\"rpc\""),
            }
        }
        check_unique(methods.iter().map(|method| &method.name))?;
        doc.is_deprecated = options.is_deprecated;
        Ok(Service { name, doc, methods })
    }

    fn method(&mut self) -> Result<Method> {
        let mut doc = self.doc();
        self.lexer.advance()?;
        let name = self.identifier()?;
        let (streams_requests, request) = self.method_type()?;
        if !self.eat_keyword("returns")? {
            return self.unexpected("\"returns\"");
        }
        let (streams_responses, response) = self.method_type()?;
        let mut options = Options::default();
        if self.eat(b'{')? {
            while !self.eat(b'}')? {
                if self.eat(b';')? {
                    continue;
                }
                if self.keyword() != "option" {
                    return self.unexpected("\"option\"");
                }
                self.option_statement(&mut options)?;
            }
        } else {
            self.expect(b';')?;
        }
        doc.is_deprecated = options.is_deprecated;
        Ok(Method {
            name,
            doc,
            request,
            response,
            streams_requests,
            streams_responses,
        })
    }

    fn method_type(&mut self) -> Result<(bool, Name)> {
        self.expect(b'(')?;
        let mut name = match self.keyword() {
            "stream" => self.identifier()?,
            _ => self.type_name()?,
        };
        let is_stream = name.text == "stream" && self.lexer.token != Token::Symbol(b')');
        if is_stream {
            name = self.type_name()?;
        }
        self.expect(b')')?;
        Ok((is_stream, name))
    }

    fn option_statement(&mut self, options: &mut Options) -> Result<()> {
        self.lexer.advance()?;
        self.option(options)?;
        self.expect(b';')
    }

    fn bracketed_options(&mut self) -> Result<Options> {
        let mut options = Options::default();
        if self.eat(b'[')? {
            loop {
                self.option(&mut options)?;
                if !self.eat(b',')? {
                    break;
                }
            }
            self.expect(b']')?;
        }
        Ok(options)
    }

    fn option(&mut self, options: &mut Options) -> Result<()> {
        let mut name = String::new();
        loop {
            if self.eat(b'(')? {
                name.push('(');
                name.push_str(&self.type_name()?.text);
                self.expect(b')')?;
            } else {
                name.push_str(&self.identifier()?.text);
            }
            if !self.eat(b'.')? {
                break;
            }
            name.push('.');
        }
        self.expect(b'=')?;
        if name == "features" && self.eat(b'{')? {
            return self.features_aggregate(&mut options.features);
        }
        let value = self.constant()?;
        match name.as_str() {
            "default" => options.default = Some(value),
            "deprecated" => options.is_deprecated = bool_of(&value)?,
            "allow_alias" => options.allows_aliases = bool_of(&value)?,
            "packed" => options.features.is_packed = Some(bool_of(&value)?),
            _ => {
                if let Some(feature) = name.strip_prefix("features.") {
                    set_feature(&mut options.features, feature, &value)?;
                }
            }
        }
        Ok(())
    }

    fn features_aggregate(&mut self, features: &mut Features) -> Result<()> {
        while !self.eat(b'}')? {
            let name = match self.eat(b'[')? {
                true => {
                    self.type_name()?;
                    self.expect(b']')?;
                    None
                }
                false => Some(self.identifier()?),
            };
            self.eat(b':')?;
            let value = self.constant()?;
            if let Some(name) = name {
                set_feature(features, &name.text, &value)?;
            }
            if !self.eat(b',')? {
                self.eat(b';')?;
            }
        }
        Ok(())
    }

    fn constant(&mut self) -> Result<Constant> {
        let span = self.lexer.span;
        let is_negative = self.eat(b'-')?;
        if !is_negative {
            self.eat(b'+')?;
        }
        let value = match self.lexer.token {
            Token::Identifier(_) => ConstantValue::Identifier(self.type_name()?.text),
            Token::Integer(text) | Token::Float(text) => {
                let integer = match self.lexer.token {
                    Token::Integer(_) => parse_integer(text).map(ConstantValue::Integer),
                    _ => None,
                };
                let number = integer.or_else(|| text.parse().ok().map(ConstantValue::Float));
                let invalid = || Failure::new(self.lexer.span, "Invalid number");
                let number = number.ok_or_else(invalid)?;
                self.lexer.advance()?;
                number
            }
            Token::String(_) => ConstantValue::String(self.string()?),
            Token::Symbol(b'{') => {
                self.skip_aggregate()?;
                ConstantValue::Aggregate
            }
            _ => return self.unexpected("a value"),
        };
        Ok(Constant {
            is_negative,
            value,
            span,
        })
    }

    fn skip_aggregate(&mut self) -> Result<()> {
        let mut depth = 0usize;
        loop {
            match self.lexer.token {
                Token::Symbol(b'{') => depth += 1,
                Token::Symbol(b'}') => depth -= 1,
                Token::End => return self.unexpected("\"}\""),
                _ => {}
            }
            self.lexer.advance()?;
            if depth == 0 {
                return Ok(());
            }
        }
    }
}

pub(crate) fn bool_of(constant: &Constant) -> Result<bool> {
    match &constant.value {
        ConstantValue::Identifier(name) if name == "true" && !constant.is_negative => Ok(true),
        ConstantValue::Identifier(name) if name == "false" && !constant.is_negative => Ok(false),
        _ => Err(Failure::new(
            constant.span,
            "Expected \"true\" or \"false\"",
        )),
    }
}

fn set_feature(features: &mut Features, name: &str, constant: &Constant) -> Result<()> {
    let value = match &constant.value {
        ConstantValue::Identifier(value) => value.as_str(),
        _ => "",
    };
    match (name, value) {
        ("field_presence", "EXPLICIT") => features.presence = Some(Presence::Explicit),
        ("field_presence", "IMPLICIT") => features.presence = Some(Presence::Implicit),
        ("field_presence", "LEGACY_REQUIRED") => features.presence = Some(Presence::Required),
        ("enum_type", "OPEN" | "CLOSED") => features.is_enum_closed = Some(value == "CLOSED"),
        ("repeated_field_encoding", "PACKED" | "EXPANDED") => {
            features.is_packed = Some(value == "PACKED");
        }
        ("utf8_validation", "VERIFY" | "NONE") => features.verifies_utf8 = Some(value == "VERIFY"),
        ("message_encoding", "LENGTH_PREFIXED" | "DELIMITED") => {
            features.is_delimited = Some(value == "DELIMITED");
        }
        (
            "field_presence"
            | "enum_type"
            | "repeated_field_encoding"
            | "utf8_validation"
            | "message_encoding",
            _,
        ) => {
            let message = format!("Invalid value for \"features.{name}\"");
            return Err(Failure::new(constant.span, message));
        }
        _ => {}
    }
    Ok(())
}
