use super::runtime_json::{parse_runtime_package_json, parse_runtime_tsconfig};
use crate::host::Disk;
use bun_sema::atom::Interner;
use bun_sema::json::Json;
use bun_sema::resolve::{
    CodeHost, CodeParseRequest, Host, ModuleDetection, ParsedCode, ScriptKind,
};
use bun_sema::session::Arena;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

impl Disk {
    pub fn parse_code_as<'s>(
        &self,
        script_kind: Option<ScriptKind>,
        arena: &'s Arena,
        request: &CodeParseRequest<'_>,
        text: &[u8],
        atoms: &Interner<'s>,
    ) -> ParsedCode<'s> {
        let options = CompileParseOptions {
            path: request.path,
            script_kind,
            experimental_decorators: request.options.experimental_decorators,
            every_file_is_a_module: request.options.module_detection == ModuleDetection::Force,
            reads_jsdoc: request.reads_jsdoc,
            keeps_function_directives: false,
        };
        ParsedCode {
            hir: parse_for_compile(arena, &options, text, atoms),
            host_values: &[],
            payload: None,
        }
    }
}

impl CodeHost for Disk {
    fn parse_runtime_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
        parse_runtime_package_json(arena, text)
    }

    fn parse_runtime_tsconfig(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
        parse_runtime_tsconfig(arena, text)
    }

    fn parse_code<'s>(
        &self,
        arena: &'s Arena,
        request: &CodeParseRequest<'_>,
        text: &[u8],
        atoms: &Interner<'s>,
    ) -> ParsedCode<'s> {
        self.parse_code_as(self.script_kind(request.path), arena, request, text, atoms)
    }
}
