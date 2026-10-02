#!/bin/sh
# clippy-driver alone on c21-sink-probe.rs with the clippy table of the workspace (Cargo.toml of the worktree, [workspace.lints.clippy]) and its clippy.toml.
# Run: sh c21-sink-probe-clippy.sh        (with --test as its argument: the test module too)
cd "$(dirname "$0")" || exit 1
CLIPPY_CONF_DIR=/workspace/wt/typecheck exec clippy-driver --edition 2024 --crate-type lib --emit=metadata "$@" -o /tmp/c21-sink-probe-clippy.rmeta c21-sink-probe.rs \
  -D clippy::ptr_as_ptr -D clippy::ptr_cast_constness -D clippy::ref_as_ptr -D clippy::borrow_as_ptr \
  -D clippy::undocumented_unsafe_blocks -D clippy::not_unsafe_ptr_arg_deref -D clippy::mem_forget -D clippy::cast_ptr_alignment \
  -D clippy::transmute_ptr_to_ptr -D clippy::as_ptr_cast_mut -D clippy::drop_non_drop -D clippy::uninit_vec \
  -D clippy::redundant_clone -D clippy::unnecessary_to_owned -D clippy::needless_collect -D clippy::or_fun_call \
  -D clippy::assigning_clones -D clippy::implicit_clone -D clippy::iter_overeager_cloned -D clippy::map_clone \
  -D clippy::trivially_copy_pass_by_ref -D clippy::large_types_passed_by_value -D clippy::large_enum_variant \
  -D clippy::large_stack_frames -D clippy::vec_init_then_push -D clippy::format_collect -D clippy::manual_memcpy \
  -D clippy::needless_pass_by_value -D clippy::unnecessary_unwrap -D clippy::derive_partial_eq_without_eq \
  -D clippy::derivable_impls -D clippy::clone_on_ref_ptr -D clippy::if_same_then_else -D clippy::todo \
  -D clippy::unimplemented -D clippy::dbg_macro -D clippy::clone_on_copy -D clippy::useless_conversion \
  -D clippy::vec_box -D clippy::boxed_local -D clippy::arc_with_non_send_sync -D clippy::manual_swap \
  -D clippy::mem_replace_option_with_none -D clippy::redundant_locals -D clippy::manual_c_str_literals \
  -D clippy::precedence -D clippy::implicit_saturating_sub -D clippy::ptr_eq \
  -D clippy::disallowed_methods -D clippy::disallowed_types -D clippy::disallowed_macros \
  -A clippy::collapsible_if -A clippy::collapsible_else_if -A clippy::collapsible_match -A clippy::too_many_arguments \
  -A clippy::type_complexity -A clippy::len_zero -A clippy::len_without_is_empty -A clippy::needless_return \
  -A clippy::module_inception -A clippy::missing_safety_doc -A clippy::let_unit_value -A clippy::needless_update \
  -A clippy::explicit_auto_deref -A clippy::doc_lazy_continuation -A clippy::doc_overindented_list_items \
  -A clippy::enum_variant_names -A clippy::upper_case_acronyms -A clippy::wrong_self_convention \
  -A clippy::should_implement_trait -A clippy::new_without_default -A clippy::self_named_constructors \
  -A clippy::single_match -A clippy::manual_range_contains -A clippy::needless_lifetimes -A clippy::needless_range_loop \
  -A clippy::while_let_loop -A clippy::while_let_on_iterator -A clippy::blocks_in_conditions \
  -A clippy::diverging_sub_expression -A clippy::declare_interior_mutable_const -A clippy::empty_line_after_doc_comments \
  -A clippy::empty_docs -A clippy::excessive_precision -A clippy::unreadable_literal -A clippy::approx_constant \
  -A clippy::result_unit_err -A clippy::only_used_in_recursion -A clippy::unnecessary_cast -A clippy::new_ret_no_self \
  -A clippy::map_identity
