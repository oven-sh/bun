use bun_engine_text::{PropertyName, Text, names};

use crate::{Error, Named, Result, integer_option};

/// A row of the table "Components of date and time formats" of ECMA-402.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Component {
    Weekday,
    Era,
    Year,
    Month,
    Day,
    DayPeriod,
    Hour,
    Minute,
    Second,
    FractionalSecondDigits,
    TimeZoneName,
}

named_enum! {
    pub enum ComponentStyle {
        TwoDigit = "2-digit",
        Numeric = "numeric",
        Narrow = "narrow",
        Short = "short",
        Long = "long",
        ShortOffset = "shortOffset",
        LongOffset = "longOffset",
        ShortGeneric = "shortGeneric",
        LongGeneric = "longGeneric",
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ComponentValue {
    Style(ComponentStyle),
    /// Of `Component::FractionalSecondDigits`.
    Digits(u8),
}

impl Component {
    /// In the order of the table.
    pub const ALL: [Component; 11] = [
        Component::Weekday,
        Component::Era,
        Component::Year,
        Component::Month,
        Component::Day,
        Component::DayPeriod,
        Component::Hour,
        Component::Minute,
        Component::Second,
        Component::FractionalSecondDigits,
        Component::TimeZoneName,
    ];

    pub fn property(self) -> PropertyName<'static> {
        match self {
            Component::Weekday => names::weekday,
            Component::Era => names::era,
            Component::Year => names::year,
            Component::Month => names::month,
            Component::Day => names::day,
            Component::DayPeriod => names::dayPeriod,
            Component::Hour => names::hour,
            Component::Minute => names::minute,
            Component::Second => names::second,
            Component::FractionalSecondDigits => names::fractionalSecondDigits,
            Component::TimeZoneName => names::timeZoneName,
        }
    }

    fn invalid_value(self) -> &'static str {
        match self {
            Component::Weekday => r#"weekday must be "narrow", "short", or "long""#,
            Component::Era => r#"era must be "narrow", "short", or "long""#,
            Component::Year => r#"year must be "2-digit" or "numeric""#,
            Component::Month => {
                r#"month must be "2-digit", "numeric", "narrow", "short", or "long""#
            }
            Component::Day => r#"day must be "2-digit" or "numeric""#,
            Component::DayPeriod => r#"dayPeriod must be "narrow", "short", or "long""#,
            Component::Hour => r#"hour must be "2-digit" or "numeric""#,
            Component::Minute => r#"minute must be "2-digit" or "numeric""#,
            Component::Second => r#"second must be "2-digit" or "numeric""#,
            Component::FractionalSecondDigits => "fractionalSecondDigits is out of range",
            Component::TimeZoneName => {
                r#"timeZoneName must be "short", "long", "shortOffset", "longOffset", "shortGeneric", or "longGeneric""#
            }
        }
    }

    /// The styles that the option takes, each with the field that asks for it in a skeleton.
    fn styles(self) -> &'static [(ComponentStyle, &'static str)] {
        use ComponentStyle::*;
        match self {
            Component::Weekday => &[(Narrow, "EEEEE"), (Short, "EEE"), (Long, "EEEE")],
            Component::Era => &[(Narrow, "GGGGG"), (Short, "GGG"), (Long, "GGGG")],
            Component::Year => &[(TwoDigit, "yy"), (Numeric, "y")],
            Component::Month => &[
                (TwoDigit, "MM"),
                (Numeric, "M"),
                (Narrow, "MMMMM"),
                (Short, "MMM"),
                (Long, "MMMM"),
            ],
            Component::Day => &[(TwoDigit, "dd"), (Numeric, "d")],
            Component::DayPeriod => &[(Narrow, "BBBBB"), (Short, "B"), (Long, "BBBB")],
            Component::Hour => &[(TwoDigit, "jj"), (Numeric, "j")],
            Component::Minute => &[(TwoDigit, "mm"), (Numeric, "m")],
            Component::Second => &[(TwoDigit, "ss"), (Numeric, "s")],
            Component::FractionalSecondDigits => &[],
            Component::TimeZoneName => &[
                (Short, "z"),
                (Long, "zzzz"),
                (ShortOffset, "O"),
                (LongOffset, "OOOO"),
                (ShortGeneric, "v"),
                (LongGeneric, "vvvv"),
            ],
        }
    }

    fn field(self, value: ComponentValue) -> &'static str {
        match value {
            ComponentValue::Digits(count) => &"SSS"[..usize::from(count.min(3))],
            ComponentValue::Style(style) => (self.styles().iter())
                .find_map(|&(it, field)| (it == style).then_some(field))
                .unwrap_or_default(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct ComponentSet(u16);

impl ComponentSet {
    pub(super) const EMPTY: ComponentSet = ComponentSet(0);
    pub(super) const ALL: ComponentSet = ComponentSet::of(&Component::ALL);
    pub(super) const ERA: ComponentSet = ComponentSet::of(&[Component::Era]);
    pub(super) const YEAR_MONTH: ComponentSet =
        ComponentSet::of(&[Component::Year, Component::Month]);
    pub(super) const MONTH_DAY: ComponentSet =
        ComponentSet::of(&[Component::Month, Component::Day]);
    pub(super) const YEAR_MONTH_DAY: ComponentSet =
        ComponentSet::YEAR_MONTH.with(ComponentSet::MONTH_DAY);
    pub(super) const DATE: ComponentSet =
        ComponentSet::YEAR_MONTH_DAY.with(ComponentSet::of(&[Component::Weekday]));
    pub(super) const HOUR_MINUTE_SECOND: ComponentSet =
        ComponentSet::of(&[Component::Hour, Component::Minute, Component::Second]);
    pub(super) const TIME: ComponentSet =
        ComponentSet::HOUR_MINUTE_SECOND.with(ComponentSet::of(&[
            Component::DayPeriod,
            Component::FractionalSecondDigits,
        ]));
    pub(super) const DATE_AND_TIME: ComponentSet = ComponentSet::DATE.with(ComponentSet::TIME);
    pub(super) const YEAR_TO_SECOND: ComponentSet =
        ComponentSet::YEAR_MONTH_DAY.with(ComponentSet::HOUR_MINUTE_SECOND);

    const fn of(components: &[Component]) -> ComponentSet {
        let mut bits = 0;
        let mut index = 0;
        while index < components.len() {
            bits |= 1 << components[index] as u16;
            index += 1;
        }
        ComponentSet(bits)
    }

    pub(super) const fn with(self, other: ComponentSet) -> ComponentSet {
        ComponentSet(self.0 | other.0)
    }

    pub(super) fn contains(self, component: Component) -> bool {
        self.0 & 1 << component as u16 != 0
    }
}

/// A value for each component that a format shows.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct Components([Option<ComponentValue>; Component::ALL.len()]);

impl Components {
    /// The validation of GetOption. `Component::FractionalSecondDigits` takes no string.
    pub fn set_style(&mut self, component: Component, style: Text<'_>) -> Result<()> {
        let &(style, _) = (component.styles().iter())
            .find(|(it, _)| style.eq_ascii(it.as_str()))
            .ok_or(Error::Range(component.invalid_value()))?;
        self.set(component, ComponentValue::Style(style));
        Ok(())
    }

    /// The validation of GetNumberOption.
    pub fn set_fractional_second_digits(&mut self, number: f64) -> Result<()> {
        let component = Component::FractionalSecondDigits;
        let digits = integer_option(number, 1..=3, component.invalid_value())?;
        self.set(component, ComponentValue::Digits(digits as u8));
        Ok(())
    }

    pub(super) fn set(&mut self, component: Component, value: ComponentValue) {
        self.0[component as usize] = Some(value);
    }

    pub(super) fn has(&self, component: Component) -> bool {
        self.0[component as usize].is_some()
    }

    pub(super) fn has_any(&self, set: ComponentSet) -> bool {
        self.iter().any(|(component, _)| set.contains(component))
    }

    /// In the order of the table.
    pub fn iter(&self) -> impl DoubleEndedIterator<Item = (Component, ComponentValue)> {
        (Component::ALL.into_iter().zip(self.0))
            .filter_map(|(component, value)| Some((component, value?)))
    }

    pub(super) fn only(mut self, set: ComponentSet) -> Components {
        for (component, value) in Component::ALL.into_iter().zip(&mut self.0) {
            *value = value.filter(|_| set.contains(component));
        }
        self
    }

    pub(super) fn set_numeric(&mut self, set: ComponentSet) {
        for component in Component::ALL {
            if set.contains(component) {
                self.set(component, ComponentValue::Style(ComponentStyle::Numeric));
            }
        }
    }

    /// The letters of a skeleton, where `j` stands for the hour.
    pub(super) fn skeleton(&self) -> impl Iterator<Item = u8> {
        // Backwards, since `j` brings a day period that only a later one overrides.
        (self.iter().rev()).flat_map(|(component, value)| component.field(value).bytes())
    }
}
