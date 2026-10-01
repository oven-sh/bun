#[cfg(test)]
mod tests {
    use bun_js_parser::function_identities::{FunctionIdentities, Text};

    #[test]
    fn javascript_parse_only() {
        let text = b"function f(a) { return a + 1 }\nconst g = async (x) => x;\n";
        let got = FunctionIdentities::of_text(text, Text::Module, &[]);
        assert!(got.is_some());
    }

    #[test]
    fn typescript_parse_and_visit() {
        let arena = bun_alloc::Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let text = b"interface I { a: string }\ntype T<U> = U extends string ? 1 : 2;\nexport function f<V>(a: V, b?: I): T<V> { return (a as any)!; }\n";
        let source = bun_ast::Source::init_path_string(&b"probe.ts"[..], &text[..]);
        let mut opts = bun_js_parser::ParserOptions::init(Default::default(), bun_ast::Loader::Ts);
        opts.features.no_macros = true;
        opts.transform_only = true;
        opts.suppress_warnings_about_weird_code = true;
        let define = bun_js_parser::Define::default();
        let mut log = bun_ast::Log::init();
        let parser = bun_js_parser::Parser::init(opts, &mut log, &source, &define, &arena);
        assert!(parser.is_ok());
        let Ok(parser) = parser else { return };
        let result = parser.parse();
        assert!(result.is_ok());
        assert_eq!(log.errors, 0);
    }
}
