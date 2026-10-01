#![deny(warnings, dead_code, unreachable_pub, unused_imports)]
#![deny(clippy::ptr_as_ptr, clippy::redundant_clone, clippy::unnecessary_to_owned, clippy::needless_collect, clippy::or_fun_call, clippy::assigning_clones, clippy::implicit_clone, clippy::iter_overeager_cloned, clippy::map_clone, clippy::trivially_copy_pass_by_ref, clippy::large_types_passed_by_value, clippy::large_enum_variant, clippy::large_stack_frames, clippy::vec_init_then_push, clippy::format_collect, clippy::manual_memcpy, clippy::needless_pass_by_value, clippy::unnecessary_unwrap, clippy::derive_partial_eq_without_eq, clippy::derivable_impls, clippy::clone_on_ref_ptr, clippy::if_same_then_else, clippy::todo, clippy::unimplemented, clippy::dbg_macro, clippy::clone_on_copy, clippy::useless_conversion, clippy::manual_swap, clippy::redundant_locals, clippy::precedence, clippy::implicit_saturating_sub, clippy::disallowed_methods, clippy::disallowed_types, clippy::disallowed_macros)]
#![allow(clippy::collapsible_if, clippy::collapsible_else_if, clippy::len_zero, clippy::needless_return, clippy::upper_case_acronyms, clippy::enum_variant_names)]
pub mod comment_directives;
pub mod pragmas;

mod strings {
    pub(super) fn index_of(text: &[u8], s: &[u8]) -> Option<usize> {
        (0..text.len()).find(|&at| text.get(at..).is_some_and(|rest| rest.starts_with(s)))
    }
    pub(super) fn index_of_char_usize(text: &[u8], char: u8) -> Option<usize> {
        (0..text.len()).find(|&at| text.get(at) == Some(&char))
    }
}

mod syntax_errors {
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) struct Message {
        pub(crate) code: u32,
        pub(crate) text: &'static [u8],
    }
    pub(crate) const INVALID_REFERENCE_DIRECTIVE_SYNTAX: Message = Message {
        code: 1084,
        text: b"Invalid 'reference' directive syntax.",
    };
    pub(crate) const X_RESOLUTION_MODE_SHOULD_BE_EITHER_REQUIRE_OR_IMPORT: Message = Message {
        code: 1453,
        text: b"`resolution-mode` should be either `require` or `import`.",
    };
}

/// What the entry does with the two modules.
pub fn entry(text: &[u8], comments: &[(u32, u32)]) -> (usize, usize, u32) {
    let mut errors = 0;
    let directives = comment_directives::scan_comment_directives(text, comments.iter().copied());
    let header = pragmas::Pragmas::read(text, &mut |_, _, message| errors += message.code + message.text.len() as u32);
    let leading = pragmas::get_leading_comment_ranges(text);
    (directives.len() + leading.len(), header.pragmas.len(), errors)
}
