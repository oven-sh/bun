use bun_engine_text::Text;
use bun_engine_vm::{JsFunction, RealmSlot, RegExpObject, regexp_exec};

use super::constructor::to_regexp;
use super::{accessors, matching, replace, split, this_object};
use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::compile, compile, 2),
    StaticProperty::realm_slot(names::exec, RealmSlot::regexp_prototype_exec),
    StaticProperty::function(names::toString, to_string, 0),
    StaticProperty::getter(names::global, accessors::global)
        .with_intrinsic(Intrinsic::RegExpGlobal),
    StaticProperty::getter(names::dotAll, accessors::dot_all)
        .with_intrinsic(Intrinsic::RegExpDotAll),
    StaticProperty::getter(names::hasIndices, accessors::has_indices)
        .with_intrinsic(Intrinsic::RegExpHasIndices),
    StaticProperty::getter(names::ignoreCase, accessors::ignore_case)
        .with_intrinsic(Intrinsic::RegExpIgnoreCase),
    StaticProperty::getter(names::multiline, accessors::multiline)
        .with_intrinsic(Intrinsic::RegExpMultiline),
    StaticProperty::getter(names::sticky, accessors::sticky)
        .with_intrinsic(Intrinsic::RegExpSticky),
    StaticProperty::getter(names::unicode, accessors::unicode)
        .with_intrinsic(Intrinsic::RegExpUnicode),
    StaticProperty::getter(names::unicodeSets, accessors::unicode_sets)
        .with_intrinsic(Intrinsic::RegExpUnicodeSets),
    StaticProperty::getter(names::source, accessors::source)
        .with_intrinsic(Intrinsic::RegExpSource),
    StaticProperty::getter(names::flags, accessors::flags)
        .with_intrinsic(Intrinsic::RegExpFlags),
    StaticProperty::function(names::test, test, 1).with_intrinsic(Intrinsic::RegExpTest),
    StaticProperty::realm_slot(names::constructor, RealmSlot::regexp_constructor),
    StaticProperty::function(symbols::r#match, matching::symbol_match, 1)
        .with_intrinsic(Intrinsic::RegExpMatch),
    StaticProperty::function(symbols::matchAll, matching::symbol_match_all, 1),
    StaticProperty::function(symbols::replace, replace::symbol_replace, 2),
    StaticProperty::function(symbols::search, matching::symbol_search, 1)
        .with_intrinsic(Intrinsic::RegExpSearch),
    StaticProperty::function(symbols::split, split::symbol_split, 2)
        .with_intrinsic(Intrinsic::RegExpSplit),
]);

define_object!(RegExpPrototype, "Object", PROPERTIES);

pub(super) fn initialize(cx: &Cx) {
    let global = cx.global();
    let prototype = RegExpPrototype::create(cx, cx.object_prototype().into());
    global.init_regexp_shape(RegExpObject::create_shape(cx, global, prototype));
    global.init_regexp_prototype(prototype);
}

pub(super) fn initialize_exec(cx: &Cx) {
    let name = names::exec.to_identifier().into_string();
    let exec = JsFunction::native_with_intrinsic(cx, 1, &name, exec, Intrinsic::RegExpExec);
    cx.global().init_regexp_prototype_exec(exec);
}

#[native_abi]
fn exec(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(this) = frame.this_value().downcast::<RegExpObject>() else {
        let message = "Builtin RegExp exec can only be called on a RegExp object";
        return Err(cx.throw_type_error(message));
    };
    let string = frame.argument(0).to_string(cx)?;
    this.exec(cx, string)
}

#[native_abi]
fn test(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "RegExp.prototype.test requires that |this| be an Object";
    let mut this = this_object(cx, frame, message)?;
    let string = frame.argument(0).to_string(cx)?;
    if let Some(regexp) = this.downcast::<RegExpObject>() {
        if regexp.has_pristine_exec(cx) {
            return regexp.test(cx, string).map(Into::into);
        }
        this = regexp.unshared(cx).upcast();
    }
    Ok(regexp_exec(cx, this, string)?.is_some().into())
}

#[native_abi]
fn compile(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(this) = frame.this_value().downcast::<RegExpObject>() else {
        return Err(cx.throw_type_error("Type error"));
    };
    if this.realm() != Some(cx.global()) {
        return Err(cx.throw_type_error(
            "RegExp.prototype.compile function's Realm must be the same to |this| RegExp object",
        ));
    }
    if !this.has_legacy_features() {
        let message = "|this| RegExp object's legacy features are not enabled";
        return Err(cx.throw_type_error(message));
    }
    let (pattern, flags) = (frame.argument(0), frame.argument(1));
    let regexp = match pattern.downcast::<RegExpObject>() {
        Some(other) if flags.is_undefined() => other.regexp(),
        Some(_) => {
            let message = "Cannot supply flags when constructing one RegExp from another.";
            return Err(cx.throw_type_error(message));
        }
        None => to_regexp(cx, pattern, flags)?,
    };
    this.recompile(cx, regexp)?;
    Ok(this.into())
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_object(cx, frame, "Type error")?;
    let source = this.get(cx, names::source)?.to_string_view(cx)?;
    let flags = this.get(cx, names::flags)?.to_string_view(cx)?;
    let solidus = Text::from_ascii("/");
    let parts = [solidus, source.text(), solidus, flags.text()];
    cx.new_string_from_parts(&parts).map(Into::into)
}
