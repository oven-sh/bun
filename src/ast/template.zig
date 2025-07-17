pub fn Template(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const jsx_transform_type = P.jsx_transform_type;
        const allow_macros = P.allow_macros;
        const BinaryExpressionVisitor = P.BinaryExpressionVisitor;
        const is_typescript_enabled = P.is_typescript_enabled;
        const createDefaultName = P.createDefaultName;
        const track_symbol_usage_during_parse_pass = P.track_symbol_usage_during_parse_pass;
        const extractDeclsForBinding = P.extractDeclsForBinding;
        const is_jsx_enabled = P.is_jsx_enabled;
        const only_scan_imports_and_do_not_visit = P.only_scan_imports_and_do_not_visit;
        const LowerUsingDeclarationsContext = P.LowerUsingDeclarationsContext;
        const isSimpleParameterList = P.isSimpleParameterList;
    };
}

// @sortImports @noRemoveUnused

const bun = @import("bun");

const js_parser = bun.js_parser;
const JSXTransformType = js_parser.JSXTransformType;
