// internal/checker: one module per upstream file, re-exported as the package's namespace. checker.go is cut along contiguous line ranges into c01 to c52, in upstream order. tracer.go, services.go, nodebuilder_hover.go and exports.go have no module.
pub mod c01_data;
pub mod c02_program_checker;
pub mod c03_init;
pub mod c04_name_resolution_hooks;
pub mod c05_check_source_file;
pub mod c06_check_members_type_nodes;
pub mod c07_check_functions;
pub mod c08_check_statements;
pub mod c09_check_classes_interfaces;
pub mod c10_check_enums_modules_imports;
pub mod c11_check_variables_decorators;
pub mod c12_iteration_types;
pub mod c13_check_aliases_unused;
pub mod c14_expressions;
pub mod c15_calls;
pub mod c16_function_expressions_collisions;
pub mod c17_unary_meta_yield;
pub mod c18_identifiers_property_access_this;
pub mod c19_assertions_binary_operators;
pub mod c20_object_literals_spread;
pub mod c21_resolved_symbols_diagnostics;
pub mod c22_symbols_merge;
pub mod c23_alias_targets;
pub mod c24_external_modules;
pub mod c25_entity_names;
pub mod c26_exports_late_binding;
pub mod c27_resolve_alias;
pub mod c28_types_of_symbols;
pub mod c29_constraints;
pub mod c30_type_keys;
pub mod c31_binding_patterns_widening;
pub mod c32_type_resolution;
pub mod c33_members_base_types_signatures;
pub mod c34_return_types;
pub mod c35_resolve_members;
pub mod c36_properties_apparent_types;
pub mod c37_instantiation;
pub mod c38_type_nodes_references;
pub mod c39_declared_types_enums;
pub mod c40_type_nodes_conditional_tuples;
pub mod c41_new_types;
pub mod c42_literal_types;
pub mod c43_unions_intersections;
pub mod c44_index_indexed_access;
pub mod c45_base_constraints_normalization;
pub mod c46_mark_references;
pub mod c47_promised_mapped_template;
pub mod c48_contextual_types;
pub mod c49_call_arguments_decorator_signatures;
pub mod c50_contextual_properties_inference_context;
pub mod c51_type_facts_awaited;
pub mod c52_symbol_at_location;
pub mod emitresolver;
pub mod flow;
pub mod grammarchecks;
pub mod inference;
pub mod jsdoc;
pub mod jsx;
pub mod links;
pub mod mapper;
pub mod nodebuilder;
pub mod nodebuilderimpl;
pub mod nodebuilderscopes;
pub mod nodecopy;
pub mod printer;
pub mod pseudotypenodebuilder;
pub mod relater;
pub mod stringer_generated;
pub mod symbolaccessibility;
pub mod symboltracker;
pub mod types;
pub mod utilities;

// A module that holds only methods of the checker exports no name, and its glob then re-exports nothing.
#[allow(unused_imports)]
pub use {
    c01_data::*, c02_program_checker::*, c03_init::*, c04_name_resolution_hooks::*,
    c05_check_source_file::*, c06_check_members_type_nodes::*, c07_check_functions::*,
    c08_check_statements::*, c09_check_classes_interfaces::*, c10_check_enums_modules_imports::*,
    c11_check_variables_decorators::*, c12_iteration_types::*, c13_check_aliases_unused::*,
    c14_expressions::*, c15_calls::*, c16_function_expressions_collisions::*,
    c17_unary_meta_yield::*, c18_identifiers_property_access_this::*,
    c19_assertions_binary_operators::*, c20_object_literals_spread::*,
    c21_resolved_symbols_diagnostics::*, c22_symbols_merge::*, c23_alias_targets::*,
    c24_external_modules::*, c25_entity_names::*, c26_exports_late_binding::*,
    c27_resolve_alias::*, c28_types_of_symbols::*, c29_constraints::*, c30_type_keys::*,
    c31_binding_patterns_widening::*, c32_type_resolution::*, c33_members_base_types_signatures::*,
    c34_return_types::*, c35_resolve_members::*, c36_properties_apparent_types::*,
    c37_instantiation::*, c38_type_nodes_references::*, c39_declared_types_enums::*,
    c40_type_nodes_conditional_tuples::*, c41_new_types::*, c42_literal_types::*,
    c43_unions_intersections::*, c44_index_indexed_access::*,
    c45_base_constraints_normalization::*, c46_mark_references::*, c47_promised_mapped_template::*,
    c48_contextual_types::*, c49_call_arguments_decorator_signatures::*,
    c50_contextual_properties_inference_context::*, c51_type_facts_awaited::*,
    c52_symbol_at_location::*, emitresolver::*, flow::*, grammarchecks::*, inference::*, jsdoc::*,
    jsx::*, links::*, mapper::*, nodebuilder::*, nodebuilderimpl::*, nodebuilderscopes::*,
    nodecopy::*, printer::*, pseudotypenodebuilder::*, relater::*, symbolaccessibility::*,
    symboltracker::*, types::*, utilities::*,
};
