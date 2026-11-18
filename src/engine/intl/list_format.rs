//! `Intl.ListFormat`

use core::cell::OnceCell;
use core::cmp::Ordering;
use std::borrow::Cow;
use std::rc::Rc;

use bun_engine_text::{StringBuilder, StringRef};
use bun_icu::formatted_value::Category;
use bun_icu::list_format::{ELEMENT_FIELD, Kind, ListFormatter, Width};
use smallvec::SmallVec;

use crate::error::IcuResult;
use crate::locale_resolver::ResolvedLocale;
use crate::parts::new_string;
use crate::{AvailableLocales, Cache, Error, LanguageTag, PartKind, Result, Style};

option_enum! {
    #[derive(Default)]
    pub enum Type: "type must be either \"conjunction\", \"disjunction\", or \"unit\"" {
        #[default]
        Conjunction = "conjunction",
        Disjunction = "disjunction",
        Unit = "unit",
    }
}

/// Those with the same locale and options are one.
#[derive(Clone)]
pub struct ListFormat(Rc<Shared>);

struct Shared {
    locale: ResolvedLocale,
    kind: Type,
    style: Style,
    formatter: ListFormatter,
    /// By the number of stand-ins, for `NEUTRAL` as the last.
    neutral_literals: [OnceCell<Literals>; MAX_STAND_INS + 1],
}

impl ListFormat {
    pub fn new(
        cache: &Cache,
        requested: &[LanguageTag],
        kind: Type,
        style: Style,
    ) -> Result<ListFormat> {
        let locale = ResolvedLocale::new(cache, AvailableLocales::general(), requested)?;
        cache.list_formats.find_or_insert(
            |it| it.0.kind == kind && it.0.style == style && it.0.locale == locale,
            || {
                let icu_kind = match kind {
                    Type::Conjunction => Kind::And,
                    Type::Disjunction => Kind::Or,
                    Type::Unit => Kind::Units,
                };
                let width = match style {
                    Style::Long => Width::Wide,
                    Style::Short => Width::Short,
                    Style::Narrow => Width::Narrow,
                };
                let formatter = ListFormatter::open(&locale.icu_locale(&[])?, icu_kind, width)
                    .or_type_error("failed to initialize ListFormat")?;
                Ok(ListFormat(Rc::new(Shared {
                    locale: locale.clone(),
                    kind,
                    style,
                    formatter,
                    neutral_literals: Default::default(),
                })))
            },
        )
    }

    pub fn locale(&self) -> &LanguageTag {
        self.0.locale.tag()
    }

    pub fn kind(&self) -> Type {
        self.0.kind
    }

    pub fn style(&self) -> Style {
        self.0.style
    }

    pub fn format(&self, list: &[StringRef]) -> Result<StringRef> {
        if let [only] = list {
            return Ok(only.clone());
        }
        let literals = self.literals(list)?;
        let pieces = || pieces(&literals, list).map(|(_, piece)| piece);
        let length = pieces().fold(0usize, |sum, piece| sum.saturating_add(piece.len()));
        let mut out = StringBuilder::with_capacity(length);
        pieces().for_each(|piece| out.push_text(piece.text()));
        Ok(out.finish()?)
    }

    pub fn format_to_parts<'a>(&'a self, list: &'a [StringRef]) -> Result<ListParts<'a>> {
        Ok(ListParts {
            literals: self.literals(list)?,
            list,
        })
    }

    /// By UTS #35 the elements from the second to the last but one have the same text between them.
    fn literals(&self, list: &[StringRef]) -> Result<Cow<'_, Literals>> {
        const CONTEXT_LENGTH: usize = 8;

        let count = list.len().min(MAX_STAND_INS);
        match list.last() {
            // The conjunctions of these depend on how the next word starts.
            Some(last) if matches!(self.locale().language(), b"es" | b"he") && !last.is_empty() => {
                let context: SmallVec<[u16; CONTEXT_LENGTH]> =
                    last.text().code_units().take(CONTEXT_LENGTH).collect();
                self.literals_of_stand_ins(count, &context).map(Cow::Owned)
            }
            _ => self.0.neutral_literals[count]
                .get_or_try_init(|| self.literals_of_stand_ins(count, NEUTRAL))
                .map(Cow::Borrowed),
        }
    }

    fn literals_of_stand_ins(&self, count: usize, last: &[u16]) -> Result<Literals> {
        const FAILURE: &str = "failed to format list of strings";

        let stand_ins = (1..=count).map(|it| if it == count { last } else { NEUTRAL });
        let formatted = self.0.formatter.format(stand_ins).or_type_error(FAILURE)?;
        let formatted = formatted.value().or_type_error(FAILURE)?;
        let text = formatted.text().or_type_error(FAILURE)?;
        let mut elements = formatted
            .fields_matching(Category::LIST, ELEMENT_FIELD)
            .or_type_error(FAILURE)?;
        let mut literals = Literals::new();
        let mut start = 0;
        while let Some(element) = elements.next().or_type_error(FAILURE)? {
            let literal = text.get(start..element.range.start);
            literals.push(new_string(literal.unwrap_or_default())?);
            start = element.range.end;
        }
        literals.push(new_string(text.get(start..).unwrap_or_default())?);
        if literals.len() != count + 1 {
            return Err(Error::Type(FAILURE));
        }
        Ok(literals)
    }
}

const MAX_STAND_INS: usize = 4;
/// Selects the patterns that an empty element gets.
const NEUTRAL: &[u16] = &[0x05d0];

/// What comes before each element of a list of at most `MAX_STAND_INS`, and after the last.
type Literals = SmallVec<[StringRef; MAX_STAND_INS + 1]>;

fn pieces<'a>(
    literals: &'a Literals,
    list: &'a [StringRef],
) -> impl Iterator<Item = (PartKind, &'a StringRef)> {
    let literal_before = move |index: usize| {
        let slot = match (index + 1).cmp(&list.len()) {
            Ordering::Less => index.min(MAX_STAND_INS - 2),
            Ordering::Equal => literals.len() - 2,
            Ordering::Greater => literals.len() - 1,
        };
        let literal = &literals[slot];
        (!literal.is_empty()).then_some((PartKind::Literal, literal))
    };
    (0..=list.len()).flat_map(move |index| {
        let element = list.get(index).map(|element| (PartKind::Element, element));
        literal_before(index).into_iter().chain(element)
    })
}

pub struct ListParts<'a> {
    literals: Cow<'a, Literals>,
    list: &'a [StringRef],
}

impl ListParts<'_> {
    pub fn iter(&self) -> impl Iterator<Item = (PartKind, &StringRef)> {
        pieces(&self.literals, self.list)
    }
}
