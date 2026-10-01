#![deny(warnings, dead_code, unreachable_pub, unused_variables, unused_mut)]
pub mod regexpp {
    pub enum Error { Syntax(RegExpSyntaxError), Unknown, TooDeep }
    pub struct RegExpSyntaxError { pub message: Vec<u16>, pub index: usize }
    #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    pub enum EcmaVersion { Es5 = 5, Es2015 = 2015, Es2018 = 2018, Es2025 = 2025 }
    pub const LATEST_ECMA_VERSION: EcmaVersion = EcmaVersion::Es2025;
    #[derive(Clone, Copy, Default)]
    pub struct PatternFlags { pub unicode: bool, pub unicode_sets: bool }

    mod reader {
        pub(crate) struct Reader<'s> { unicode: bool, s: &'s [u16], i: usize, end: usize, cp1: i32, w1: usize }
        impl<'s> Reader<'s> {
            pub(crate) fn new() -> Self { Reader { unicode: false, s: &[], i: 0, end: 0, cp1: -1, w1: 1 } }
            fn at(&self, i: usize) -> i32 {
                if i >= self.end { return -1; }
                let Some(&first) = self.s.get(i) else { return -1 };
                if self.unicode && (0xd800..=0xdbff).contains(&first) {
                    if let Some(&second) = self.s.get(i + 1) && (0xdc00..=0xdfff).contains(&second) {
                        return (i32::from(first) - 0xd800) * 0x400 + (i32::from(second) - 0xdc00) + 0x10000;
                    }
                }
                i32::from(first)
            }
            fn width(&self, c: i32) -> usize { if self.unicode && c > 0xffff { 2 } else { 1 } }
            pub(crate) fn source(&self) -> &'s [u16] { self.s }
            pub(crate) fn index(&self) -> usize { self.i }
            pub(crate) fn current_code_point(&self) -> i32 { self.cp1 }
            pub(crate) fn reset(&mut self, source: &'s [u16], start: usize, end: usize, u_flag: bool) { self.unicode = u_flag; self.s = source; self.end = end; self.rewind(start); }
            pub(crate) fn rewind(&mut self, index: usize) { self.i = index; self.cp1 = self.at(index); self.w1 = self.width(self.cp1); }
            pub(crate) fn advance(&mut self) { if self.cp1 != -1 { self.i += self.w1; self.cp1 = self.at(self.i); self.w1 = self.width(self.cp1); } }
            pub(crate) fn eat(&mut self, cp: i32) -> bool { if self.cp1 == cp { self.advance(); return true; } false }
        }
    }

    pub mod validator {
        use super::reader::Reader;
        use super::{EcmaVersion, Error, LATEST_ECMA_VERSION, PatternFlags, RegExpSyntaxError};
        pub trait Options {
            fn strict(&self) -> bool { false }
            fn ecma_version(&self) -> EcmaVersion { LATEST_ECMA_VERSION }
            fn on_pattern_enter(&mut self, _start: usize) -> Result<(), Error> { Ok(()) }
            fn on_pattern_leave(&mut self, _start: usize, _end: usize) -> Result<(), Error> { Ok(()) }
            fn on_character(&mut self, _start: usize, _end: usize, _value: u32) -> Result<(), Error> { Ok(()) }
            fn on_capturing_group_enter(&mut self, _start: usize, _name: Option<&str>) -> Result<(), Error> { Ok(()) }
            fn on_capturing_group_leave(&mut self, _start: usize, _end: usize, _name: Option<&str>) -> Result<(), Error> { Ok(()) }
        }
        impl Options for () {}
        pub struct RegExpValidator<'s, 'o> { options: &'o mut dyn Options, reader: Reader<'s>, unicode_mode: bool, last_int_value: f64, depth_left: u32 }
        impl<'s, 'o> RegExpValidator<'s, 'o> {
            pub fn new(options: &'o mut dyn Options) -> Self { RegExpValidator { options, reader: Reader::new(), unicode_mode: false, last_int_value: 0.0, depth_left: 1000 } }
            pub fn validate_pattern(&mut self, source: &'s [u16], start: usize, end: usize, flags: PatternFlags) -> Result<(), Error> {
                self.unicode_mode = (flags.unicode || flags.unicode_sets) && self.options.ecma_version() >= EcmaVersion::Es2015;
                self.reader.reset(source, start, end, self.unicode_mode);
                self.consume_pattern()
            }
            fn raise(&self, message: &str) -> Error {
                let mut text: Vec<u16> = "Invalid regular expression: /".encode_utf16().collect();
                text.extend_from_slice(self.reader.source());
                text.extend("/: ".encode_utf16());
                text.extend(message.encode_utf16());
                Error::Syntax(RegExpSyntaxError { message: text, index: self.reader.index() })
            }
            fn consume_pattern(&mut self) -> Result<(), Error> {
                let start = self.reader.index();
                self.options.on_pattern_enter(start)?;
                self.consume_disjunction()?;
                if self.reader.current_code_point() != -1 { return Err(self.raise("Unmatched ')'")); }
                self.options.on_pattern_leave(start, self.reader.index())
            }
            fn consume_disjunction(&mut self) -> Result<(), Error> {
                if self.depth_left == 0 { return Err(Error::TooDeep); }
                self.depth_left -= 1;
                while self.reader.current_code_point() != -1 && self.consume_term()? {}
                self.depth_left += 1;
                Ok(())
            }
            fn consume_term(&mut self) -> Result<bool, Error> { Ok(self.consume_capturing_group()? || (self.consume_pattern_character()? && self.consume_optional_quantifier()?)) }
            fn consume_optional_quantifier(&mut self) -> Result<bool, Error> { if self.reader.eat(0x2a) && self.options.strict() { return Err(self.raise("Nothing to repeat")); } Ok(true) }
            fn consume_capturing_group(&mut self) -> Result<bool, Error> {
                let start = self.reader.index();
                if self.reader.eat(0x28) {
                    let name: Option<String> = None;
                    self.options.on_capturing_group_enter(start, name.as_deref())?;
                    self.consume_disjunction()?;
                    if !self.reader.eat(0x29) { return Err(self.raise("Unterminated group")); }
                    self.options.on_capturing_group_leave(start, self.reader.index(), name.as_deref())?;
                    return Ok(true);
                }
                Ok(false)
            }
            fn consume_pattern_character(&mut self) -> Result<bool, Error> {
                let start = self.reader.index();
                let cp = self.reader.current_code_point();
                if cp != -1 && cp != 0x29 && cp != 0x28 {
                    self.reader.advance();
                    self.last_int_value = f64::from(cp);
                    self.options.on_character(start, self.reader.index(), self.last_int_value as u32)?;
                    return Ok(true);
                }
                Ok(false)
            }
        }
    }

    pub mod ast {
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub struct NodeId(pub(crate) u32);
        pub struct Node { pub parent: Option<NodeId>, pub start: usize, pub end: usize, pub data: NodeData }
        pub enum NodeData { Pattern { elements: Vec<NodeId> }, CapturingGroup { name: Option<String>, elements: Vec<NodeId> }, Character { value: u32 } }
        pub struct Ast<'s> { pub source: &'s [u16], pub nodes: Vec<Node>, pub root: NodeId }
        impl core::ops::Index<NodeId> for Ast<'_> { type Output = Node; fn index(&self, id: NodeId) -> &Node { &self.nodes[id.0 as usize] } }
        impl<'s> Ast<'s> { pub fn raw(&self, id: NodeId) -> &'s [u16] { let node = &self[id]; self.source.get(node.start..node.end).unwrap_or(&[]) } }
    }

    pub mod parser {
        use super::ast::{Ast, Node, NodeData, NodeId};
        use super::validator::{self, RegExpValidator};
        use super::{EcmaVersion, Error, LATEST_ECMA_VERSION, PatternFlags};
        #[derive(Clone, Copy)]
        pub struct Options { pub strict: bool, pub ecma_version: EcmaVersion }
        impl Default for Options { fn default() -> Self { Options { strict: false, ecma_version: LATEST_ECMA_VERSION } } }
        struct RegExpParserState { strict: bool, ecma_version: EcmaVersion, node: Option<NodeId>, nodes: Vec<Node> }
        impl RegExpParserState {
            fn push(&mut self, node: Node) -> NodeId { let id = NodeId(self.nodes.len() as u32); self.nodes.push(node); id }
            fn elements(&mut self, id: NodeId) -> Result<&mut Vec<NodeId>, Error> {
                match self.nodes.get_mut(id.0 as usize).map(|n| &mut n.data) { Some(NodeData::Pattern { elements } | NodeData::CapturingGroup { elements, .. }) => Ok(elements), _ => Err(Error::Unknown) }
            }
        }
        impl validator::Options for RegExpParserState {
            fn strict(&self) -> bool { self.strict }
            fn ecma_version(&self) -> EcmaVersion { self.ecma_version }
            fn on_pattern_enter(&mut self, start: usize) -> Result<(), Error> { self.nodes.clear(); let id = self.push(Node { parent: None, start, end: start, data: NodeData::Pattern { elements: Vec::new() } }); self.node = Some(id); Ok(()) }
            fn on_pattern_leave(&mut self, _start: usize, end: usize) -> Result<(), Error> { let id = self.node.ok_or(Error::Unknown)?; self.nodes[id.0 as usize].end = end; Ok(()) }
            fn on_character(&mut self, start: usize, end: usize, value: u32) -> Result<(), Error> { let parent = self.node.ok_or(Error::Unknown)?; let id = self.push(Node { parent: Some(parent), start, end, data: NodeData::Character { value } }); self.elements(parent)?.push(id); Ok(()) }
            fn on_capturing_group_enter(&mut self, start: usize, name: Option<&str>) -> Result<(), Error> { let parent = self.node.ok_or(Error::Unknown)?; let id = self.push(Node { parent: Some(parent), start, end: start, data: NodeData::CapturingGroup { name: name.map(str::to_owned), elements: Vec::new() } }); self.elements(parent)?.push(id); self.node = Some(id); Ok(()) }
            fn on_capturing_group_leave(&mut self, _start: usize, end: usize, _name: Option<&str>) -> Result<(), Error> { let id = self.node.ok_or(Error::Unknown)?; let node = &mut self.nodes[id.0 as usize]; node.end = end; self.node = node.parent; Ok(()) }
        }
        pub struct RegExpParser { options: Options }
        impl RegExpParser {
            pub fn new(options: Options) -> Self { RegExpParser { options } }
            pub fn parse_pattern<'s>(&self, source: &'s [u16], start: usize, end: usize, flags: PatternFlags) -> Result<Ast<'s>, Error> {
                let mut state = RegExpParserState { strict: self.options.strict, ecma_version: self.options.ecma_version, node: None, nodes: Vec::new() };
                RegExpValidator::new(&mut state).validate_pattern(source, start, end, flags)?;
                let root = state.node.ok_or(Error::Unknown)?;
                Ok(Ast { source, nodes: state.nodes, root })
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::regexpp::{parser::{Options, RegExpParser}, ast::NodeData, Error, PatternFlags, validator::RegExpValidator};
    #[test]
    fn shape() {
        let source: Vec<u16> = "a(b\u{1F600})".encode_utf16().collect();
        let ast = RegExpParser::new(Options::default()).parse_pattern(&source, 0, source.len(), PatternFlags { unicode: true, unicode_sets: false }).ok().unwrap();
        let NodeData::Pattern { elements } = &ast[ast.root].data else { panic!() };
        assert_eq!(elements.len(), 2);
        assert_eq!(ast.raw(elements[1]).len(), 5);
        let bad: Vec<u16> = "(a".encode_utf16().collect();
        let Err(Error::Syntax(error)) = RegExpValidator::new(&mut ()).validate_pattern(&bad, 0, bad.len(), PatternFlags::default()) else { panic!() };
        assert_eq!(String::from_utf16_lossy(&error.message), "Invalid regular expression: /(a/: Unterminated group");
        assert_eq!(error.index, 2);
    }
}
