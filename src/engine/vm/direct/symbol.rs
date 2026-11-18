use bun_engine_macros::direct_form;
use bun_engine_text::SymbolRef;

use super::operand::Undefined;
use super::outcome::Flat;
use crate::{Cx, Gc, JsResult, JsString, JsSymbol, Vm};

#[direct_form(pure, gives_new)]
fn new_symbol(vm: &Vm, _: Undefined) -> Gc<JsSymbol> {
    JsSymbol::create(vm, None)
}

#[direct_form(pure, only_lacks_room, gives_new)]
fn new_symbol_with_description(cx: &Cx, description: Gc<JsString>) -> JsResult<Gc<JsSymbol>> {
    JsSymbol::with_description(cx, description)
}

#[direct_form(pure, only_lacks_room, gives_the_same)]
pub fn symbol_for(cx: &Cx, key: Gc<JsString>) -> JsResult<Gc<JsSymbol>> {
    let symbol = SymbolRef::registered(&*key.resolve(cx)?);
    Ok(JsSymbol::for_symbol(cx, symbol))
}

#[direct_form(pure, only_lacks_room)]
fn symbol_to_string(cx: &Cx, this: Gc<JsSymbol>) -> JsResult<Flat> {
    this.to_descriptive_string(cx).map(Flat::made_by)
}
