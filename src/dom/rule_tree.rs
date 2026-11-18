//! The rules of a style sheet as scripts see them. What is inside of a rule is parsed when it is asked for.

use core::cell::{Cell, OnceCell, Ref, RefCell};
use core::ops::Range;
use std::rc::Rc;

use crate::declarations::{Accepts, DeclarationList, Key, Specified};
use crate::prelude::{FeatureKind, Inside, Prelude, written};
use crate::scan::{self, Next};
use crate::selector_parser::{Namespaces, Parser};
use crate::sheet::{AtKind, Block, Source, Within, visit_declarations};
use crate::values::{Out, text, write_ident, write_list};

/// What the rules of a sheet are parsed with.
#[derive(Default)]
pub(crate) struct Settings {
    pub(crate) namespaces: RefCell<Namespaces>,
    pub(crate) base_url: RefCell<Rc<[u8]>>,
    pub(crate) is_quirky: Cell<bool>,
}

pub(crate) enum RuleError {
    IndexSize,
    Syntax,
    HierarchyRequest,
    InvalidState,
}

pub(crate) type FeatureValues = Vec<(Out, Vec<u32>)>;

#[derive(Default)]
struct Contents {
    rules: RefCell<Vec<Rc<Rule>>>,
    declarations: Out,
}

pub(crate) struct Rule {
    prelude: RefCell<Prelude>,
    inside: Cell<Inside>,
    accepts: Accepts,
    depth: u16,
    settings: Rc<Settings>,
    source: Source,
    /// `None` for a statement.
    body: Option<Range<usize>>,
    contents: OnceCell<Contents>,
    style: OnceCell<RefCell<DeclarationList>>,
    is_style_edited: Cell<bool>,
    features: OnceCell<RefCell<Vec<(FeatureKind, FeatureValues)>>>,
}

/// What the engine compiles.
#[derive(Default)]
pub(crate) struct EngineText {
    pub(crate) text: Out,
    /// By where they would have started in the text.
    pub(crate) blocks: Vec<(u32, Rc<Block>)>,
}

enum Item {
    Rule(Range<usize>, Option<Range<usize>>),
    Declaration(Range<usize>),
}

#[derive(Clone, Copy, PartialEq)]
enum Level {
    Sheet,
    Rules,
    RulesAndDeclarations,
}

fn items(source: &[u8], range: Range<usize>, level: Level) -> impl Iterator<Item = Item> {
    let (source, mut at) = (&source[..range.end], range.start);
    core::iter::from_fn(move || {
        match if level == Level::RulesAndDeclarations {
            scan::next_item(source, at)
        } else {
            scan::next_rule(source, at, level == Level::Rules)
        } {
            Next::End(_) => None,
            Next::Statement { start, end } => {
                at = end;
                Some(if source[start] == b'@' {
                    Item::Rule(start..end - usize::from(source[end - 1] == b';'), None)
                } else {
                    Item::Declaration(start..end)
                })
            }
            Next::Block { start, brace } => {
                let end = scan::end_of_block(source, brace).0;
                at = end + 1;
                Some(Item::Rule(start..brace, Some(brace + 1..end)))
            }
        }
    })
}

/// Where the rules of a list are.
#[derive(Clone, Copy)]
pub(crate) struct Place<'a> {
    inside: Inside,
    accepts: Accepts,
    settings: &'a Rc<Settings>,
    depth: u16,
}

const MAX_DEPTH: u16 = 256;

impl<'a> Place<'a> {
    pub(crate) fn top(settings: &'a Rc<Settings>) -> Place<'a> {
        let within = if settings.is_quirky.get() {
            Within::Quirks
        } else {
            Within::Style
        };
        Place {
            inside: Inside::Sheet,
            accepts: Accepts::Properties(within),
            settings,
            depth: 0,
        }
    }

    fn rule(self, prelude: Prelude, source: &Source, body: Option<Range<usize>>) -> Rule {
        let accepts = match &prelude {
            Prelude::Defines(AtKind::Keyframes, _) => Accepts::Properties(Within::Keyframe),
            Prelude::Defines(AtKind::PositionTry, _) => Accepts::Properties(Within::PositionTry),
            Prelude::Defines(kind, _) => Accepts::Descriptors(*kind),
            Prelude::Function(..) => Accepts::Descriptors(AtKind::Function),
            Prelude::Page(_) => Accepts::Properties(Within::Style),
            _ => self.accepts,
        };
        Rule {
            prelude: prelude.into(),
            inside: self.inside.into(),
            accepts,
            depth: self.depth,
            settings: Rc::clone(self.settings),
            source: source.clone(),
            body,
            contents: OnceCell::new(),
            style: OnceCell::new(),
            is_style_edited: Cell::new(false),
            features: OnceCell::new(),
        }
    }

    fn parse(
        self,
        source: &Source,
        prelude: Range<usize>,
        body: Option<Range<usize>>,
    ) -> Option<Rule> {
        (self.depth < MAX_DEPTH).then_some(())?;
        let parsed = Prelude::parse(
            &source[prelude],
            self.inside,
            body.clone().map(|it| &source[it]),
            &self.settings.namespaces.borrow(),
        )?;
        Some(self.rule(parsed, source, body))
    }

    /// `None` if none is valid.
    fn declarations(self, declarations: Out) -> Option<Rule> {
        let contents = Contents {
            declarations,
            ..Contents::default()
        }
        .into();
        Some(Rule {
            contents,
            ..self.rule(Prelude::Declarations, &Source::default(), Some(0..0))
        })
        .filter(|it| !it.style().is_empty())
    }

    /// <https://drafts.csswg.org/css-syntax/#parse-a-rule>
    pub(crate) fn parse_rule(self, rule: &[u8]) -> Option<Rule> {
        let source = Source::copy_of(rule);
        let mut all = items(&source, 0..source.len(), Level::Sheet);
        let found = match (all.next(), all.next()) {
            (Some(Item::Rule(prelude, body)), None) => self.parse(&source, prelude, body),
            _ => None,
        };
        found.or_else(|| {
            matches!(self.inside, Inside::Style | Inside::Scope)
                .then(|| self.declarations(rule.to_vec()))?
        })
    }

    pub(crate) fn parse_sheet(self, source: &Source, allows_imports: bool) -> Vec<Rc<Rule>> {
        let (mut rules, mut latest): (Vec<Rc<Rule>>, _) = (Vec::new(), Rank::Import);
        self.settings.namespaces.take();
        for item in items(source, 0..source.len(), Level::Sheet) {
            let Item::Rule(prelude, body) = item else {
                continue;
            };
            let Some(rule) = self
                .parse(source, prelude, body)
                .filter(|it| it.rank() >= latest && (allows_imports || it.rank() != Rank::Import))
            else {
                continue;
            };
            if !rule.is_layer_statement() || rules.iter().any(|it| it.rank() < Rank::Other) {
                latest = rule.rank();
            }
            if let Prelude::Namespace { prefix, url } = &*rule.prelude() {
                self.settings
                    .namespaces
                    .borrow_mut()
                    .push((prefix.clone(), Rc::clone(url)));
            }
            rules.push(Rc::new(rule));
        }
        rules
    }

    /// <https://drafts.csswg.org/cssom/#insert-a-css-rule>, once it is parsed
    pub(crate) fn insert(
        self,
        rules: &mut Vec<Rc<Rule>>,
        rule: Rc<Rule>,
        index: usize,
    ) -> Result<(), RuleError> {
        let rank = rule.rank();
        if rank == Rank::Namespace
            && self.depth == 0
            && rules.iter().any(|it| it.rank() == Rank::Other)
        {
            return Err(RuleError::InvalidState);
        }
        let (before, after) = rules.split_at(index);
        if rank < Rank::Other && self.depth > 0
            || before
                .iter()
                .rfind(|it| !it.is_layer_statement())
                .is_some_and(|it| it.rank() > rank)
            || after
                .iter()
                .find(|it| !it.is_layer_statement())
                .is_some_and(|it| it.rank() < rank)
                && !rule.is_layer_statement()
        {
            return Err(RuleError::HierarchyRequest);
        }
        rules.insert(index, rule);
        Ok(())
    }
}

/// The order that they have to be in.
#[derive(Clone, Copy, PartialEq, PartialOrd)]
pub(crate) enum Rank {
    Import,
    Namespace,
    Other,
}

impl FeatureKind {
    pub(crate) const ALL: [FeatureKind; 6] = [
        FeatureKind::Annotation,
        FeatureKind::Ornaments,
        FeatureKind::Stylistic,
        FeatureKind::Swash,
        FeatureKind::CharacterVariant,
        FeatureKind::Styleset,
    ];

    pub(crate) fn takes(self, values: &[u32]) -> bool {
        let most = match self {
            FeatureKind::Styleset => 20,
            FeatureKind::CharacterVariant => 2,
            _ => 1,
        };
        (1..=most).contains(&values.len())
    }
}

fn descriptor_order(kind: AtKind) -> Option<&'static [&'static str]> {
    Some(match kind {
        AtKind::CounterStyle => &[
            "system",
            "symbols",
            "additive-symbols",
            "negative",
            "prefix",
            "suffix",
            "pad",
            "range",
            "fallback",
            "speak-as",
        ],
        AtKind::FontPaletteValues => &["font-family", "base-palette", "override-colors"],
        AtKind::Property => &["syntax", "inherits", "initial-value"],
        AtKind::ViewTransition => &["navigation", "types"],
        _ => return None,
    })
}

impl Rule {
    pub(crate) fn prelude(&self) -> Ref<'_, Prelude> {
        self.prelude.borrow()
    }

    pub(crate) fn edit_prelude(&self, edit: impl FnOnce(&mut Prelude)) {
        edit(&mut self.prelude.borrow_mut());
    }

    /// From what follows the keyword. Whether it is valid.
    pub(crate) fn set_prelude(&self, source: &[u8]) -> bool {
        let (keyword, inside, namespaces) = (
            self.prelude().keyword(),
            self.inside.get(),
            self.settings.namespaces.borrow(),
        );
        let parsed = match keyword.is_empty() {
            true => Prelude::parse(source, inside, Some(b""), &namespaces)
                .filter(|it| it.keyword().is_empty()),
            false => Prelude::parse_at_rule(
                keyword.as_bytes(),
                scan::trim(source),
                inside,
                Some(b""),
                &namespaces,
            ),
        };
        parsed.map(|it| self.prelude.replace(it)).is_some()
    }

    pub(crate) fn supports_condition(&self) -> bool {
        let Prelude::Supports(condition) = &*self.prelude() else {
            return false;
        };
        crate::condition::supports(
            condition,
            Parser {
                namespaces: &self.settings.namespaces.borrow(),
                is_quirky: self.settings.is_quirky.get(),
                ..Parser::default()
            },
        ) == Some(true)
    }

    pub(crate) fn inside(&self) -> Inside {
        self.inside.get()
    }

    pub(crate) fn rank(&self) -> Rank {
        match &*self.prelude() {
            Prelude::Import(_) => Rank::Import,
            Prelude::Namespace { .. } => Rank::Namespace,
            _ => Rank::Other,
        }
    }

    pub(crate) fn is_layer_statement(&self) -> bool {
        matches!(&*self.prelude(), Prelude::LayerStatement(_))
    }

    /// Of the rules in this one.
    pub(crate) fn place(&self) -> Place<'_> {
        Place {
            inside: self.prelude().contents_inside(self.inside.get()),
            accepts: self.accepts,
            settings: &self.settings,
            depth: self.depth + 1,
        }
    }

    fn contents(&self) -> &Contents {
        self.contents.get_or_init(|| {
            let (place, prelude) = (self.place(), self.prelude());
            let (mut rules, mut own, mut nested) = (Vec::new(), Out::new(), Out::new());
            let mut are_own = !prelude.is_group() && !matches!(*prelude, Prelude::Function(..));
            for item in items(
                &self.source,
                self.body.clone().unwrap_or_default(),
                if place.inside.has_declarations() {
                    Level::RulesAndDeclarations
                } else {
                    Level::Rules
                },
            ) {
                match item {
                    Item::Declaration(range) if place.inside.has_declarations() => {
                        (if are_own { &mut own } else { &mut nested })
                            .extend_from_slice(&self.source[range])
                    }
                    Item::Declaration(_) => {}
                    Item::Rule(head, body) => {
                        let Some(rule) = place.parse(&self.source, head, body) else {
                            continue;
                        };
                        rules.extend(
                            place
                                .declarations(core::mem::take(&mut nested))
                                .map(Rc::new),
                        );
                        rules.extend(
                            Some(rule)
                                .filter(|it| it.rank() == Rank::Other)
                                .map(Rc::new),
                        );
                        are_own &= !prelude.keyword().is_empty();
                    }
                }
            }
            rules.extend(place.declarations(nested).map(Rc::new));
            Contents {
                rules: rules.into(),
                declarations: own,
            }
        })
    }

    pub(crate) fn rules(&self) -> Ref<'_, Vec<Rc<Rule>>> {
        self.contents().rules.borrow()
    }

    pub(crate) fn insert_rule(&self, source: &[u8], index: usize) -> Result<(), RuleError> {
        let mut rules = self.contents().rules.borrow_mut();
        (index <= rules.len()).ok_or(RuleError::IndexSize)?;
        let place = self.place();
        let error = || {
            Place {
                depth: place.depth,
                ..Place::top(place.settings)
            }
            .parse_rule(source)
            .map_or(RuleError::Syntax, |_| RuleError::HierarchyRequest)
        };
        place.insert(
            &mut rules,
            Rc::new(place.parse_rule(source).ok_or_else(error)?),
            index,
        )
    }

    pub(crate) fn delete_rule(&self, index: usize) -> Result<(), RuleError> {
        let mut rules = self.contents().rules.borrow_mut();
        (index < rules.len()).ok_or(RuleError::IndexSize)?;
        rules.remove(index).inside.set(Inside::Sheet);
        Ok(())
    }

    pub(crate) fn find_keyframe(&self, selector: &[u8]) -> Option<usize> {
        let wanted = crate::prelude::keyframe_selector(selector)?;
        self.rules()
            .iter()
            .rposition(|it| matches!(&*it.prelude(), Prelude::Keyframe(it) if *it == wanted))
    }

    pub(crate) fn accepts(&self) -> Accepts {
        self.accepts
    }

    fn style_cell(&self) -> &RefCell<DeclarationList> {
        self.style.get_or_init(|| {
            DeclarationList::parse(self.accepts, &self.contents().declarations).into()
        })
    }

    pub(crate) fn style(&self) -> Ref<'_, DeclarationList> {
        self.style_cell().borrow()
    }

    /// `edit` says whether it has changed anything.
    pub(crate) fn edit_style(&self, edit: impl FnOnce(&mut DeclarationList) -> bool) -> bool {
        let has_changed = edit(&mut self.style_cell().borrow_mut());
        self.is_style_edited
            .set(self.is_style_edited.get() || has_changed);
        has_changed
    }

    pub(crate) fn descriptor(&self, name: &'static str) -> Out {
        self.style().get(Key::Descriptor(name)).into_owned()
    }

    /// <https://drafts.csswg.org/css-counter-styles/#the-csscounterstylerule-interface>
    pub(crate) fn set_counter_descriptor(&self, name: &'static str, value: &[u8]) -> bool {
        let algorithm = |system: &[u8]| Some(crate::hooks::words(system).first()?.to_vec());
        let system = algorithm(&self.descriptor("system")).unwrap_or_else(|| b"symbolic".into());
        let Some(specified) = Specified::parse(self.accepts, Key::Descriptor(name), value, false)
        else {
            return false;
        };
        let is_refused = match name {
            "system" => algorithm(specified.written()).is_none_or(|it| it != system),
            "symbols" | "additive-symbols" if system == b"extends" => true,
            "symbols" => {
                matches!(&system[..], b"alphabetic" | b"numeric")
                    && crate::hooks::words(specified.written()).len() < 2
            }
            _ => false,
        };
        !is_refused && self.edit_style(|it| it.set(&Rc::new(specified)))
    }

    fn features(&self) -> &RefCell<Vec<(FeatureKind, FeatureValues)>> {
        self.features.get_or_init(|| {
            let mut all: Vec<_> = FeatureKind::ALL
                .into_iter()
                .map(|it| (it, FeatureValues::new()))
                .collect();
            for block in self.rules().iter() {
                let Prelude::Feature(kind) = *block.prelude() else {
                    continue;
                };
                visit_declarations(
                    &block.source[block.body.clone().unwrap_or_default()],
                    |name, value, important| {
                        let values: Option<Vec<u32>> = text(value)
                            .split_ascii_whitespace()
                            .map(|it| it.parse().ok())
                            .collect();
                        if let Some(values) = values
                            .filter(|it| !important && kind.takes(it) && !name[0].is_ascii_digit())
                        {
                            set_feature(&mut all[kind as usize].1, name, values);
                        }
                    },
                );
            }
            all.into()
        })
    }

    pub(crate) fn with_features<R>(
        &self,
        kind: FeatureKind,
        run: impl FnOnce(&mut FeatureValues) -> R,
    ) -> R {
        run(&mut self.features().borrow_mut()[kind as usize].1)
    }

    fn feature_blocks(&self) -> Vec<Out> {
        let block = |(kind, values): &(FeatureKind, FeatureValues)| {
            written(|out| {
                out.extend([b"@", kind.name().as_bytes(), b" { "].concat());
                for (name, values) in values {
                    write_ident(name, out);
                    out.extend_from_slice(b": ");
                    write_list(values, " ", out, |it, out| {
                        out.extend(it.to_string().bytes())
                    });
                    out.extend_from_slice(b"; ");
                }
                out.push(b'}');
            })
        };
        self.features()
            .borrow()
            .iter()
            .filter(|it| !it.1.is_empty())
            .map(block)
            .collect()
    }

    /// <https://drafts.csswg.org/cssom/#serialize-a-css-rule>
    pub(crate) fn serialize(&self) -> Out {
        let prelude = self.prelude();
        let mut out = written(|out| prelude.write(out));
        if self.body.is_none() {
            out.push(b';');
            return out;
        }
        let kind = if let Prelude::Defines(kind, _) = *prelude {
            Some(kind)
        } else {
            None
        };
        let nested = if kind == Some(AtKind::FontFeatureValues) {
            self.feature_blocks()
        } else {
            self.rules().iter().map(|it| it.serialize()).collect()
        };
        let own = kind.and_then(descriptor_order).map_or_else(
            || self.style().serialize(),
            |it| self.style().serialize_in_order(it),
        );
        if let Prelude::Declarations = *prelude {
            return own;
        }
        let [open, before, after, close]: [&[u8]; 4] = match () {
            () if kind == Some(AtKind::Keyframes) => [b" { \n", b"  ", b"\n", b"}"],
            () if prelude.is_group() || prelude.keyword().is_empty() && !nested.is_empty() => {
                [b" {", b"\n  ", b"", b"\n}"]
            }
            () => [b" { ", b"", b" ", b"}"],
        };
        out.extend_from_slice(open);
        core::iter::once(&own)
            .chain(&nested)
            .filter(|it| !it.is_empty())
            .for_each(|it| out.extend([before, it, after].concat()));
        out.extend_from_slice(close);
        out
    }

    pub(crate) fn write_for_engine(&self, out: &mut EngineText) {
        let prelude = self.prelude();
        let is_bare = matches!(*prelude, Prelude::Declarations);
        prelude.write(&mut out.text);
        let Some(body) = self.body.clone() else {
            return out.text.push(b';');
        };
        let Some(contents) = self.contents.get() else {
            return out.text.extend([b"{", &self.source[body], b"}"].concat());
        };
        // An empty rule keeps declarations apart from those before them.
        out.text.extend_from_slice(if !is_bare {
            b"{"
        } else if self.inside() == Inside::Function {
            b""
        } else {
            b"&{}"
        });
        match self.accepts {
            _ if !self.is_style_edited.get() && contents.declarations.is_empty() => {}
            _ if !self.is_style_edited.get() => {
                out.text.extend([&contents.declarations[..], b";"].concat())
            }
            Accepts::Descriptors(_) => out.text.extend(self.style().descriptor_sources()),
            Accepts::Properties(within) => {
                out.blocks.push((
                    out.text.len() as u32,
                    Rc::new(Block::edited(
                        self.style().clone(),
                        within,
                        &self.settings.base_url.borrow(),
                    )),
                ));
                out.text.extend_from_slice(b"_:_;");
            }
        }
        match self.features.get() {
            Some(_) => out.text.extend(self.feature_blocks().concat()),
            None => contents
                .rules
                .borrow()
                .iter()
                .for_each(|it| it.write_for_engine(out)),
        }
        out.text.extend_from_slice(if is_bare { b"" } else { b"}" });
    }
}

pub(crate) fn set_feature(all: &mut FeatureValues, name: &[u8], values: Vec<u32>) {
    match all.iter_mut().find(|it| it.0 == name) {
        Some(known) => known.1 = values,
        None => all.push((name.to_vec(), values)),
    }
}
