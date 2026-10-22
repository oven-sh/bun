#[cfg(test)]
mod tests;

use super::generated::{
    Data, Entry, EvalScope, ExpectedResult, Function, Layout, Module, ModuleFailure, ProgramList,
    RuntimeFunctionEntry, TypeSite, Variable, WebAssemblyModule,
};
use super::ids::{
    DataId, EvalScopeId, ExpectedResultId, FunctionId, Id, LayoutId, ModuleFailureId, ModuleId,
    TypeSiteId, VariableId,
};
use super::text::{Parsed, Parser};
use super::text_lexer::TokenKind;

pub(super) fn parse_lines(parser: &mut Parser<'_>) -> Parsed<()> {
    while !parser.at(TokenKind::EndOfFile) {
        let list = parser.parse_enum(find_list, "a record keyword")?;
        parse_line(parser, list)?;
        parser.expect(TokenKind::EndOfLine, "a field or the end of the line")?;
    }
    Ok(())
}

fn find_list(keyword: &str) -> Option<ProgramList> {
    let mut lists = ProgramList::ALL.into_iter();
    lists.find(|list| list.keyword() == Some(keyword))
}

fn parse_line(parser: &mut Parser<'_>, list: ProgramList) -> Parsed<()> {
    match list {
        ProgramList::TypeSites => {
            let length = parser.program.type_sites.len();
            let record = parse_numbered::<TypeSiteId, _>(parser, length, TypeSite::parse_fields)?;
            parser.program.type_sites.push(record);
        }
        ProgramList::ExpectedResults => {
            let length = parser.program.expected_results.len();
            let parse_fields = ExpectedResult::parse_fields;
            let record = parse_numbered::<ExpectedResultId, _>(parser, length, parse_fields)?;
            parser.program.expected_results.push(record);
        }
        ProgramList::Layouts => {
            let length = parser.program.layouts.len();
            let record = parse_numbered::<LayoutId, _>(parser, length, Layout::parse_fields)?;
            parser.program.layouts.push(record);
        }
        ProgramList::Variables => {
            let length = parser.program.variables.len();
            let record = parse_numbered::<VariableId, _>(parser, length, Variable::parse_fields)?;
            parser.program.variables.push(record);
        }
        ProgramList::Modules => {
            let length = parser.program.modules.len();
            let record = parse_numbered::<ModuleId, _>(parser, length, Module::parse_fields)?;
            parser.program.modules.push(record);
        }
        ProgramList::ModuleFailures => {
            let length = parser.program.module_failures.len();
            let parse_fields = ModuleFailure::parse_fields;
            let record = parse_numbered::<ModuleFailureId, _>(parser, length, parse_fields)?;
            parser.program.module_failures.push(record);
        }
        ProgramList::EvalScopes => {
            let length = parser.program.eval_scopes.len();
            let record = parse_numbered::<EvalScopeId, _>(parser, length, EvalScope::parse_fields)?;
            parser.program.eval_scopes.push(record);
        }
        ProgramList::Functions => {
            let length = parser.program.functions.len();
            let record = parse_numbered::<FunctionId, _>(parser, length, Function::parse_fields)?;
            parser.program.functions.push(record);
        }
        ProgramList::Data => {
            let length = parser.program.data.len();
            let record = parse_numbered::<DataId, _>(parser, length, Data::parse_fields)?;
            parser.program.data.push(record);
        }
        ProgramList::Entries => {
            let record = Entry::parse_fields(parser)?;
            parser.program.entries.push(record);
        }
        ProgramList::RuntimeFunctions => {
            let record = RuntimeFunctionEntry::parse_fields(parser)?;
            parser.program.runtime_functions.push(record);
        }
        ProgramList::WebAssemblyModules => {
            let record = WebAssemblyModule::parse_fields(parser)?;
            parser.program.web_assembly_modules.push(record);
        }
        ProgramList::Bytes
        | ProgramList::Words
        | ProgramList::Strings
        | ProgramList::PropertyKeys
        | ProgramList::Types
        | ProgramList::ClassParts
        | ProgramList::DeclaredTypes
        | ProgramList::TemplateParts
        | ProgramList::ValidationRules
        | ProgramList::ValidationMembers
        | ProgramList::ValidationNodes
        | ProgramList::Fields
        | ProgramList::StaticFields
        | ProgramList::ModuleRequests
        | ProgramList::ModuleExports
        | ProgramList::SyntheticExports
        | ProgramList::RequiredNames
        | ProgramList::ColumnAdjustments
        | ProgramList::EvalBindings
        | ProgramList::RelationSubjects
        | ProgramList::StoredIntos
        | ProgramList::HandedTos
        | ProgramList::OperandsOf
        | ProgramList::Code
        | ProgramList::DataNodes
        | ProgramList::DataMembers
        | ProgramList::HostReads => unreachable!("the list has no keyword"),
    }
    Ok(())
}

fn parse_numbered<I: Id, R>(
    parser: &mut Parser<'_>,
    length: usize,
    parse_fields: fn(&mut Parser<'_>) -> Parsed<R>,
) -> Parsed<R> {
    let expected = "the next id of the list";
    let out_of_order = parser.fail(expected);
    if parser.parse_id::<I>(expected)?.index() != length {
        return out_of_order;
    }
    parse_fields(parser)
}
