// internal/module/util.go 58-79 and 122-178: the names of scoped packages in `@types`, and the message for a resolved module that its extension keeps out of the program.
use crate::ast::{Ast, NodeId};
use crate::core::{CompilerOptions, JsxEmit};
use crate::diagnostics::{self, MessageId};
use crate::module::types::ResolvedModule;
use crate::stringutil::strings;
use crate::tspath::{
    EXTENSION_CJS, EXTENSION_CTS, EXTENSION_DCTS, EXTENSION_DMTS, EXTENSION_DTS, EXTENSION_JS,
    EXTENSION_JSON, EXTENSION_JSX, EXTENSION_MJS, EXTENSION_MTS, EXTENSION_TS, EXTENSION_TSX,
};

pub fn mangle_scoped_package_name(package_name: &[u8]) -> Vec<u8> {
    if package_name.first() == Some(&b'@') {
        let idx = strings::index(package_name, b"/");
        if idx == -1 {
            return package_name.to_vec();
        }
        return [
            strings::slice(package_name, 1, idx),
            b"__",
            strings::slice_from(package_name, idx + 1),
        ]
        .concat();
    }
    package_name.to_vec()
}

pub fn unmangle_scoped_package_name(package_name: &[u8]) -> Vec<u8> {
    let (before, after, ok) = strings::cut(package_name, b"__");
    if ok {
        return [b"@".as_slice(), before, b"/", after].concat();
    }
    package_name.to_vec()
}

pub fn get_types_package_name(package_name: &[u8]) -> Vec<u8> {
    [
        b"@types/".as_slice(),
        &mangle_scoped_package_name(package_name),
    ]
    .concat()
}

// Returns a DiagnosticMessage if we won't include a resolved module due to its extension. The DiagnosticMessage's parameters are the imported module name, and the filename it resolved to. This returns a diagnostic even if the module will be an untyped module.
pub fn get_resolution_diagnostic(
    a: Ast<'_>,
    options: &CompilerOptions,
    resolved_module: &ResolvedModule<'_>,
    file: NodeId,
) -> MessageId {
    let need_jsx = || {
        if options.jsx != JsxEmit::NONE {
            return MessageId::NIL;
        }
        diagnostics::MODULE_0_WAS_RESOLVED_TO_1_BUT_JSX_IS_NOT_SET
    };

    let need_allow_js = || {
        if options.get_allow_js()
            || !options
                .no_implicit_any
                .default_if_unknown(options.strict)
                .is_true()
        {
            return MessageId::NIL;
        }
        diagnostics::COULD_NOT_FIND_A_DECLARATION_FILE_FOR_MODULE_0_1_IMPLICITLY_HAS_AN_ANY_TYPE
    };

    let need_resolve_json_module = || {
        if options.get_resolve_json_module() {
            return MessageId::NIL;
        }
        diagnostics::MODULE_0_WAS_RESOLVED_TO_1_BUT_RESOLVEJSONMODULE_IS_NOT_USED
    };

    let need_allow_arbitrary_extensions = || {
        if a.as_source_file(file).is_declaration_file
            || options.allow_arbitrary_extensions.is_true()
        {
            return MessageId::NIL;
        }
        diagnostics::MODULE_0_WAS_RESOLVED_TO_1_BUT_ALLOWARBITRARYEXTENSIONS_IS_NOT_SET
    };

    if resolved_module.resolved_using_extra_extensions {
        return MessageId::NIL;
    }

    let extension = resolved_module.extension;
    if extension == EXTENSION_TS
        || extension == EXTENSION_DTS
        || extension == EXTENSION_MTS
        || extension == EXTENSION_DMTS
        || extension == EXTENSION_CTS
        || extension == EXTENSION_DCTS
    {
        // These are always allowed.
        return MessageId::NIL;
    }
    if extension == EXTENSION_TSX {
        return need_jsx();
    }
    if extension == EXTENSION_JSX {
        let message = need_jsx();
        if !message.is_nil() {
            return message;
        }
        return need_allow_js();
    }
    if extension == EXTENSION_JS || extension == EXTENSION_MJS || extension == EXTENSION_CJS {
        return need_allow_js();
    }
    if extension == EXTENSION_JSON {
        return need_resolve_json_module();
    }
    need_allow_arbitrary_extensions()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoped_package_names() {
        assert_eq!(mangle_scoped_package_name(b"@scope/pkg"), b"scope__pkg");
        assert_eq!(mangle_scoped_package_name(b"@scope"), b"@scope");
        assert_eq!(mangle_scoped_package_name(b"pkg"), b"pkg");
        assert_eq!(mangle_scoped_package_name(b""), b"");
        assert_eq!(mangle_scoped_package_name(b"@a/b/c"), b"a__b/c");
        assert_eq!(unmangle_scoped_package_name(b"scope__pkg"), b"@scope/pkg");
        assert_eq!(unmangle_scoped_package_name(b"pkg"), b"pkg");
        assert_eq!(get_types_package_name(b"@scope/pkg"), b"@types/scope__pkg");
        assert_eq!(get_types_package_name(b"pkg"), b"@types/pkg");
    }
}
