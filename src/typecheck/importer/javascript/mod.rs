//! The JavaScript step of a producer: upstream's parser rewrites the JSDoc of a .js or .jsx file into real nodes while it parses, so a tree made of another parse gets the same nodes afterwards.

pub mod jsdoc;
pub mod jssyntax;
pub mod reparser;
#[cfg(test)]
mod tests;
mod tree;

use crate::ast::{FileBuilder, NodeId};
use crate::core::TextRange;
use crate::diagnostics::MessageId;

// A diagnostic of upstream's parser: what ast.NewDiagnostic gets before a file is attached to it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseDiagnostic {
    pub message: MessageId,
    pub loc: TextRange,
    pub args: Vec<Vec<u8>>,
    pub related_information: Vec<ParseDiagnostic>,
}

// What the JavaScript step leaves beside the tree: the ids are ids of the builder, which `finish` maps.
pub struct JavaScriptFile {
    // SourceFile.ReparsedClones
    pub reparsed_clones: Vec<NodeId>,
    // The parse diagnostics of the reparser: `merge_reparse_diagnostics` puts them among the ones of the parse.
    pub reparse_diagnostics: Vec<ParseDiagnostic>,
    // SourceFile.JSDiagnostics
    pub js_diagnostics: Vec<ParseDiagnostic>,
    // The first statement that makes the file a module now that the reparsed statements are in the list: an overload signature of an exported function comes before the function. Nil when no statement does, which leaves the indicator of the producer as it is.
    pub external_module_indicator_statement: NodeId,
}

// Turns the tree of a JavaScript file with its JSDoc comments attached into the tree that upstream's parser builds: the JSDoc nodes get upstream's shapes, their tags are reparsed into type annotations, modifiers, heritage clauses, type aliases, imports and overload signatures, and the syntax that only TypeScript has is reported. The producer calls this once, before it collects the imports of the file and before `finish`.
pub fn convert_javascript_file(b: &mut FileBuilder, source_file: NodeId) -> JavaScriptFile {
    jsdoc::convert_jsdoc_shapes(b, source_file);
    let reparsed = reparser::reparse_source_file(b, source_file);
    let js_diagnostics = jssyntax::check_js_syntax_of_source_file(b, source_file);
    JavaScriptFile {
        reparsed_clones: reparsed.reparsed_clones,
        reparse_diagnostics: reparsed.diagnostics,
        js_diagnostics,
        external_module_indicator_statement: tree::first_external_module_indicator_statement(
            b,
            source_file,
        ),
    }
}

// Puts the diagnostics of the reparser where upstream's parser, which reparses while it parses, has them among its parse diagnostics: after the last diagnostic that does not start behind them, and not at all when that one starts where they start.
pub fn merge_reparse_diagnostics(
    parse_diagnostics: &mut Vec<ParseDiagnostic>,
    reparse_diagnostics: Vec<ParseDiagnostic>,
) {
    for diagnostic in reparse_diagnostics {
        let pos = diagnostic.loc.pos();
        let at = parse_diagnostics
            .iter()
            .rposition(|earlier| earlier.loc.pos() <= pos)
            .map_or(0, |last| last + 1);
        let same_position = at
            .checked_sub(1)
            .and_then(|last| parse_diagnostics.get(last))
            .is_some_and(|last| last.loc.pos() == pos);
        if !same_position {
            parse_diagnostics.insert(at, diagnostic);
        }
    }
}
