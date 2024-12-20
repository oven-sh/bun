// This file is used as a module entry point for modules that do not exist,
// while the `bindgen.ts` code generator is in use. *Some* module has to be
// defined because Zig will eagerly resolve all source files and their Zir.
//
// If this source file appears in an error message, walk up its reference trace
// and see what is referencing it. It is highly likely that reference can be
// removed by gating it behind `Environment.export_cpp_apis`.
