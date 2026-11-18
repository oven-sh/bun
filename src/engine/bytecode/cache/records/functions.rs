use std::rc::Rc;

use bun_engine_syntax::{EvalContext, FieldKind, FieldSource, FunctionFlags, FunctionKind, Name};

use super::scopes::address;
use super::{Decoder, Place, Target, Writer, flag};
use crate::bytes::Reader;
use crate::cache::format::{FunctionHead, Variants};
use crate::cache::load::{CachedCode, Outer};
use crate::function::{Codes, Fields, FunctionInfo, FunctionName, FunctionRef, Origin, Visibility};
use crate::scope::StaticScope;

impl Writer<'_> {
    fn function(
        &mut self,
        function: &FunctionInfo,
        previous: Option<&FunctionInfo>,
        record: Option<u32>,
    ) {
        let environment =
            |it: &FunctionInfo| (it.visibility, it.context, address(it.scope.as_ref()));
        let mut head = FunctionHead::from_bits_retain(function.kind as u32);
        for (flag, is_set) in [
            (FunctionHead::HAS_OWN_NAME, function.has_own_name),
            (FunctionHead::HAS_CODE, record.is_some()),
            (
                FunctionHead::HAS_KNOWN_NAME,
                matches!(function.name, FunctionName::Known(_)),
            ),
            (
                FunctionHead::IS_NAMED_BY_SYMBOL,
                matches!(&function.name, FunctionName::Owned(it) if it.name().is_symbol()),
            ),
            (
                FunctionHead::DIFFERS,
                previous.is_none_or(|it| environment(it) != environment(function)),
            ),
            (
                FunctionHead::HAS_OTHER_TEXT,
                function.text != function.range(),
            ),
            (
                FunctionHead::IS_DEFAULT_CONSTRUCTOR,
                function.origin.contains(Origin::DEFAULT_CONSTRUCTOR),
            ),
        ] {
            head.set(flag, is_set);
        }
        let scope = self.require(self.scopes.number(function.scope.as_ref()));
        let bytes = self.bytes();
        bytes.number(head.bits());
        bytes.number(function.flags.bits().into());
        if head.contains(FunctionHead::DIFFERS) {
            bytes.put(&[function.visibility as u8, function.context.bits()]);
            bytes.number(scope);
        }
        bytes.near(previous.map_or(0, |it| it.end), function.start);
        bytes.near(function.start, function.parameters_start);
        bytes.near(function.parameters_start, function.end);
        bytes.near(function.start, function.created_at);
        bytes.number(function.length);
        if head.contains(FunctionHead::HAS_OTHER_TEXT) {
            bytes.near(function.start, function.text.start);
            bytes.near(function.end, function.text.end);
        }
        if function.kind.is_class_constructor() {
            bytes.push(function.instance_fields);
            bytes.push(function.bare_fields);
        }
        match &function.name {
            FunctionName::Known(name) => bytes.count(name.index()),
            FunctionName::Owned(name) => self.identifier(name),
            _ => self.text(function.name_text(self.source.text())),
        }
        if let Some(fields) = &function.fields {
            let bytes = self.bytes();
            bytes.push(u8::from(fields.sets_brand));
            bytes.count(fields.sources.len());
            let mut position = function.start;
            for (source, &key_slot) in fields.sources.iter().zip(&fields.key_slots) {
                bytes.push(source.kind as u8);
                bytes.near(position, source.start);
                bytes.near(source.start, source.key_start);
                bytes.near(source.start, source.initializer_start);
                bytes.number(key_slot);
                position = source.start;
            }
        }
        if let Some(record) = record {
            self.fixup(Target::Record(record));
        }
    }

    pub(super) fn functions(&mut self, functions: &Rc<[FunctionInfo]>, place: Place<'_>) {
        self.bytes().count(functions.len());
        let mut previous = None;
        for (index, function) in (0..).zip(&**functions) {
            let record = place(FunctionRef::new(Rc::clone(functions), index));
            self.function(function, previous, record);
            previous = Some(function);
        }
    }
}

/// Whether the grammar has such a function.
fn is_possible(kind: FunctionKind, flags: FunctionFlags, origin: Origin) -> bool {
    use FunctionFlags as Is;
    let suspending = Is::ASYNC | Is::AWAITS | Is::GENERATOR;
    let of_methods = Is::STATIC | Is::USES_HOME;
    let (required, allowed) = match kind {
        FunctionKind::Normal => (Is::empty(), suspending | Is::BINDS_OWN_NAME),
        FunctionKind::Arrow => (Is::empty(), Is::ASYNC | Is::AWAITS | Is::EXPRESSION_BODY),
        FunctionKind::Method => (Is::empty(), suspending | of_methods),
        FunctionKind::Getter | FunctionKind::Setter => (Is::empty(), of_methods),
        FunctionKind::NakedConstructor if !origin.contains(Origin::BUILTIN) => return false,
        _ => (Is::STRICT, of_methods),
    };
    flags.contains(required)
        && (allowed | Is::STRICT | Is::USES_HOME).contains(flags)
        && (flags.contains(Is::ASYNC) || !flags.contains(Is::AWAITS))
}

const LEAST_FUNCTION_BYTES: usize = 8;

#[cold]
fn no_function() -> FunctionInfo {
    FunctionInfo {
        name: FunctionName::Known(Name::EMPTY),
        kind: FunctionKind::Normal,
        flags: FunctionFlags::empty(),
        origin: Origin::empty(),
        visibility: Visibility::Public,
        has_own_name: false,
        context: EvalContext::empty(),
        instance_fields: 0,
        bare_fields: 0,
        text: 0..0,
        start: 0,
        parameters_start: 0,
        end: 0,
        length: 0,
        scope: None,
        created_at: 0,
        fields: None,
        code: Codes::default(),
    }
}

/// What the record of a function leaves out.
struct Previous {
    visibility: Visibility,
    context: EvalContext,
    scope: Option<Rc<StaticScope>>,
    end: u32,
}

impl Decoder<'_> {
    fn fields(
        &self,
        reader: &mut Reader<'_>,
        mut position: u32,
        class: Outer<'_>,
    ) -> Option<Box<Fields>> {
        let (sets_brand, mut key_slots) = (flag(reader)?, Vec::new());
        let has_brand = || class.is_some_and(|it| it.brand_slot().is_some());
        (!sets_brand || self.is_trusted() || has_brand()).then_some(())?;
        let sources = reader.list(|reader| {
            let kind = FieldKind::at(reader.byte()?.into())?;
            position = reader.near(position)?;
            let (key_start, initializer_start) = (reader.near(position)?, reader.near(position)?);
            let key_slot = reader.number()?;
            key_slots.push(key_slot);
            let is_valid = self.is_in_source(position, key_start)
                && self.is_in_source(0, initializer_start)
                && (kind != FieldKind::Computed
                    || class.is_some_and(|it| key_slot < it.slot_count));
            is_valid.then_some(FieldSource {
                kind,
                start: position,
                key_start,
                initializer_start,
            })
        })?;
        Some(Box::new(Fields {
            sources,
            key_slots: key_slots.into(),
            sets_brand,
        }))
    }

    fn function(&self, reader: &mut Reader<'_>, previous: &mut Previous) -> Option<FunctionInfo> {
        let head = FunctionHead::from_bits(reader.number()?)?;
        let kind = FunctionKind::at((head & FunctionHead::KIND).bits())?;
        let flags = FunctionFlags::from_bits(reader.number()?.try_into().ok()?)?;
        if head.contains(FunctionHead::DIFFERS) {
            let [visibility, context] = reader.array()?;
            previous.visibility = Visibility::at(visibility.into())?;
            previous.context = EvalContext::from_bits(context)?;
            previous.scope = self.numbered_scope(reader)?;
        }
        let start = reader.near(previous.end)?;
        let parameters_start = reader.near(start)?;
        let end = reader.near(parameters_start)?;
        previous.end = end;
        let (created_at, length) = (reader.near(start)?, reader.number()?);
        let text = match head.contains(FunctionHead::HAS_OTHER_TEXT) {
            true => reader.near(start)?..reader.near(end)?,
            false => start..end,
        };
        let has_source = !head.contains(FunctionHead::IS_DEFAULT_CONSTRUCTOR);
        let extent = if has_source { start..end } else { text.clone() };
        // So that the nesting ends.
        let is_inside = |it: &FunctionInfo| {
            it.start <= extent.start && extent.end <= it.end && extent.len() < it.range().len()
        };
        let is_valid = self.is_in_source(text.start, text.end)
            && self.function.is_none_or(is_inside)
            && self.is_in_source(start, end)
            && (!has_source || (start..=end).contains(&parameters_start))
            && (has_source || (kind.is_class_constructor() && start == end))
            && is_possible(kind, flags, self.unit.origin);
        is_valid.then_some(())?;
        let origin = match has_source {
            true => self.unit.origin,
            false => self.unit.origin.of_default_constructor(),
        };
        let (instance_fields, bare_fields) = match kind.is_class_constructor() {
            true => (reader.byte()?, reader.byte()?),
            false => (0, 0),
        };
        (bare_fields <= instance_fields).then_some(())?;
        let name = if head.contains(FunctionHead::HAS_KNOWN_NAME) {
            FunctionName::Known(Name::known(reader.number()? as usize)?)
        } else if head.contains(FunctionHead::IS_NAMED_BY_SYMBOL) {
            FunctionName::Owned(self.identifier(reader)?)
        } else {
            FunctionName::Cached(reader.number()?)
        };
        let fields = match kind {
            FunctionKind::FieldInitializer => {
                Some(self.fields(reader, start, previous.scope.as_ref())?)
            }
            _ => None,
        };
        let record = match head.contains(FunctionHead::HAS_CODE) {
            true => reader.fixed()?,
            false => 0,
        };
        let unit = Rc::clone(self.unit);
        Some(FunctionInfo {
            name,
            kind,
            flags,
            origin,
            visibility: previous.visibility,
            has_own_name: head.contains(FunctionHead::HAS_OWN_NAME),
            context: previous.context,
            instance_fields,
            bare_fields,
            text,
            start,
            parameters_start,
            end,
            length,
            scope: previous.scope.clone(),
            created_at,
            fields,
            code: Codes {
                at_hand: Default::default(),
                cached: CachedCode { unit, record }.into(),
            },
        })
    }

    pub(super) fn functions(&self, reader: &mut Reader<'_>) -> Option<Rc<[FunctionInfo]>> {
        let mut previous = Previous {
            visibility: Visibility::Public,
            context: EvalContext::empty(),
            scope: self.outer.cloned(),
            end: 0,
        };
        let count = reader.count()?;
        (count <= reader.rest().len() / LEAST_FUNCTION_BYTES).then_some(())?;
        let mut is_intact = true;
        // An iterator of known length fills the allocation in place.
        let functions = (0..count).map(|_| {
            let function = is_intact.then(|| self.function(reader, &mut previous));
            function.flatten().unwrap_or_else(|| {
                is_intact = false;
                no_function()
            })
        });
        let functions = functions.collect();
        is_intact.then_some(functions)
    }
}
