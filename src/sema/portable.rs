//! Whether two parses of a file are the same, field by field.
//!
//! The programs of one check have a declaration file in common. What they share has to be what each of them would have
//! parsed and bound itself: a debug build does that for every such file, and compares.

use crate::bind::{Bound, BoundIn};
use crate::hir::{File, FileIn};

/// Calls `$with` with the fields of a `FileIn`, except `text` and `lazy`.
macro_rules! file_fields {
    ($with:ident) => {
        $with! {
            plain: [
                kind is_js is_flow check_directive is_module_by_decree has_module_syntax
                has_errors ran_out_of_stack legacy_decorators may_bind_a_parameter_twice
                has_parse_diagnostics
                syntax_errors error_pos source_len body jsx_pragmas bases
            ]
            lists: [
                comments mentioned body_starts modifiers_of_params specifier_uses parens
                jsx_expressions ids numbers exprs stmts types pats pat_props
                pat_elems fns params type_params classes interfaces aliases members
                props var_decls calls cases imports import_specs exports
                export_specs modifiers names fn_nodes class_nodes
            ]
            few: [
                decorators references comment_directives with_bodies after_skipped
                modifiers_of_props unclosed_literals stray_decorators
                deferred_import_calls import_call_type_args import_attributes
                specifier_expressions exports_from_expressions non_null_ends
                jsdoc_comments jsdoc_asterisks jsdoc_hosts jsdoc_types
                jsdoc_modifiers functions_with_param_tags unmatched_augments_tags
                enums enum_members modules jsx import_equals tuple_elems mapped
                keyword_identifier_positions
            ]
            kept: [
                diagnostics jsdoc_member_comments jsdoc_param_errors
            ]
        }
    };
}

/// The same for a `BoundIn`, except `symbols`, `large_tables`, `nested_names` and `this_in_type_literal`.
macro_rules! bound_fields {
    ($with:ident) => {
        $with! {
            plain: [
                ran_out_of_stack file_symbol commonjs_indicator
                module_exports_property flow_places
            ]
            lists: [
                scopes tables entries ids specifiers expr_symbol expr_parent
                expr_flow stmt_parent stmt_scope type_scope type_by_alias pat_parent
                pat_symbol prop_owner member_symbol member_owner member_scope
                param_fn type_param_symbol type_param_scope fns
                requires_scope_change fn_symbol class_symbol class_owner class_scope
                interface_symbol interface_scope interface_contains_this
                alias_symbol alias_scope var_stmt assignments case_stmt stmt_flow
                case_fallthrough import_scope export_scope free_idents alias_idents
                flow flow_edges flow_shared expr_kinds expr_kind_counts
            ]
            few: [
                export_stars ambient_modules pattern_ambient_modules
                global_augmentations redeclarations umd_globals module_augmentations
                ambient_specifiers enum_scope module_scope enum_symbol
                enum_member_symbol enum_member_owner module_symbol
                module_instance_state unchecked_assignment_targets
                type_query_operands unchecked_exprs unchecked_types infer_positions
                expando_declarations computed_symbols hoisted_vars
                refused_decorators unused_labels import_equals_scope
                private_names_outside_class_bodies classes_of_private_names
                arguments_objects identifiers_in_parameters jsdoc_param_errors
                names_resolved_for_arguments
            ]
            maps: [
                property_symbol expr_scope private_class
            ]
        }
    };
}

/// The name of a field in which the two files or their side tables differ. Both have the atoms of one interner.
pub fn first_difference(a: (&File, &Bound), b: (&File, &Bound)) -> Option<&'static str> {
    macro_rules! same {
        ($a:expr, $b:expr, $name:expr) => {
            if format!("{:?}", $a) != format!("{:?}", $b) {
                return Some($name);
            }
        };
    }
    macro_rules! files {
        (plain: [$($p:ident)*] lists: [$($l:ident)*] few: [$($f:ident)*] kept: [$($k:ident)*]) => {
            // A field that is not listed is a compile error.
            let FileIn { $($p: _,)* $($l: _,)* $($f: _,)* $($k: _,)* text: _, lazy: _ } = a.0;
            $(same!(a.0.$p, b.0.$p, stringify!($p));)*
            $(same!(&a.0.$l[..], &b.0.$l[..], stringify!($l));)*
            $(same!(&a.0.$f[..], &b.0.$f[..], stringify!($f));)*
            $(same!(&a.0.$k[..], &b.0.$k[..], stringify!($k));)*
        };
    }
    file_fields!(files);
    macro_rules! bounds {
        (plain: [$($p:ident)*] lists: [$($l:ident)*] few: [$($f:ident)*] maps: [$($m:ident)*]) => {
            let BoundIn {
                $($p: _,)* $($l: _,)* $($f: _,)* $($m: _,)*
                symbols: _, large_tables: _, nested_names: _, this_in_type_literal: _,
            } = a.1;
            $(same!(a.1.$p, b.1.$p, stringify!($p));)*
            $(same!(&a.1.$l[..], &b.1.$l[..], stringify!($l));)*
            $(same!(&a.1.$f[..], &b.1.$f[..], stringify!($f));)*
            $(if a.1.$m != b.1.$m {
                return Some(stringify!($m));
            })*
        };
    }
    bound_fields!(bounds);
    if a.1.large_tables != b.1.large_tables {
        return Some("large_tables");
    }
    if a.1.this_in_type_literal != b.1.this_in_type_literal {
        return Some("this_in_type_literal");
    }
    same!(&a.1.nested_names[..], &b.1.nested_names[..], "nested_names");
    let symbol = |it: &crate::bind::Symbol| {
        let decls = format!("{:?}", it.decls.as_slice());
        let tables = (it.parent, it.exports, it.members, it.export_symbol);
        format!(
            "{:?}",
            (it.name, it.flags, decls, it.value_declaration, tables)
        )
    };
    if !a
        .1
        .symbols
        .iter()
        .map(symbol)
        .eq(b.1.symbols.iter().map(symbol))
    {
        return Some("symbols");
    }
    None
}
