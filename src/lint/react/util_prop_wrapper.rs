#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/propWrapper.js` of eslint-plugin-react.

use bun_core::strings;
use bun_lint::prelude::*;

/// `func[key]`, if that is a string.
fn string_of<'a>(func: &'a Json, key: &[u8]) -> Option<&'a [u8]> {
    func.get(key)?.as_str()
}

/// `searchPropWrapperFunctions`
fn search_prop_wrapper_functions(
    name: &[u8],
    prop_wrapper_functions: &mut dyn Iterator<Item = &Json>,
) -> bool {
    // `None`: `splitName.length` is not 2.
    let split_name = strings::split_once_char(name, b'.');
    let split_name = split_name.filter(|it| !strings::contains_char(it.1, b'.'));
    for func in prop_wrapper_functions {
        if let Some((object, property)) = split_name
            && string_of(func, b"object") == Some(object)
            && string_of(func, b"property") == Some(property)
        {
            return true;
        }
        if func.as_str() == Some(name) || string_of(func, b"property") == Some(name) {
            return true;
        }
    }
    false
}

/// `getPropWrapperFunctions`. Nothing for what is no array: upstream throws, or takes a string for
/// its characters.
fn get_prop_wrapper_functions<'a>(file: &'a File<'a>) -> &'a [Json] {
    let prop_wrapper_functions = file.settings().get(b"propWrapperFunctions");
    (prop_wrapper_functions.and_then(Json::as_array)).unwrap_or_default()
}

/// `isPropWrapperFunction`
pub(crate) fn is_prop_wrapper_function<'a>(file: &'a File<'a>, name: &[u8]) -> bool {
    search_prop_wrapper_functions(name, &mut get_prop_wrapper_functions(file).iter())
}

/// `getExactPropWrapperFunctions`
pub(crate) fn get_exact_prop_wrapper_functions<'a>(
    file: &'a File<'a>,
) -> impl Iterator<Item = &'a Json> {
    let prop_wrapper_functions = get_prop_wrapper_functions(file).iter();
    prop_wrapper_functions.filter(|func| func.get(b"exact").and_then(Json::as_bool) == Some(true))
}

/// `isExactPropWrapperFunction`
pub(crate) fn is_exact_prop_wrapper_function<'a>(file: &'a File<'a>, name: &[u8]) -> bool {
    search_prop_wrapper_functions(name, &mut get_exact_prop_wrapper_functions(file))
}

/// `formatPropWrapperFunctions(getExactPropWrapperFunctions(context))`. `None`: there is none.
pub(crate) fn format_exact_prop_wrapper_functions<'a>(file: &'a File<'a>) -> Option<Vec<u8>> {
    let mut formatted = Vec::new();
    for func in get_exact_prop_wrapper_functions(file) {
        let truthy = |key: &[u8]| string_of(func, key).filter(|it| !it.is_empty());
        let opening: &[u8] = if formatted.is_empty() { b"'" } else { b", '" };
        formatted.extend_from_slice(opening);
        match (truthy(b"object"), truthy(b"property")) {
            (Some(object), Some(property)) => {
                formatted.extend_from_slice(object);
                formatted.push(b'.');
                formatted.extend_from_slice(property);
            }
            (None, Some(property)) => formatted.extend_from_slice(property),
            (_, None) => formatted.extend_from_slice(b"[object Object]"),
        }
        formatted.push(b'\'');
    }
    (!formatted.is_empty()).then_some(formatted)
}
