use std::fmt::Write;

use super::generated::{
    Data, Entry, EvalScope, ExpectedResult, Function, Layout, Module, ModuleFailure, ProgramList,
    RuntimeFunctionEntry, TypeSite, Variable, WebAssemblyModule,
};
use super::ids::{FunctionId, Id};
use super::program::{NameTables, Program};

pub struct Printer<'a> {
    pub out: &'a mut String,
    pub names: NameTables<'a>,
}

impl<'a> Printer<'a> {
    pub fn new(names: NameTables<'a>, out: &'a mut String) -> Printer<'a> {
        Printer { out, names }
    }

    pub fn print_separated<T>(
        &mut self,
        items: impl IntoIterator<Item = T>,
        mut print_item: impl FnMut(&mut Self, T),
    ) {
        for (index, item) in items.into_iter().enumerate() {
            if index > 0 {
                self.out.push_str(", ");
            }
            print_item(self, item);
        }
    }

    fn print_lines<R>(
        &mut self,
        list: ProgramList,
        records: &[R],
        print_fields: impl Fn(&R, &mut Printer<'a>),
    ) {
        let keyword = list.keyword().expect("the list prints on its own");
        for (index, record) in records.iter().enumerate() {
            self.out.push_str(keyword);
            if let Some(prefix) = list.prefix() {
                let _ = write!(self.out, " {prefix}{index}");
            }
            print_fields(record, self);
            self.out.push('\n');
        }
    }

    fn print_list(&mut self, program: &Program, list: ProgramList) {
        match list {
            ProgramList::TypeSites => {
                self.print_lines(list, &program.type_sites, TypeSite::print_fields);
            }
            ProgramList::ExpectedResults => {
                self.print_lines(
                    list,
                    &program.expected_results,
                    ExpectedResult::print_fields,
                );
            }
            ProgramList::Layouts => {
                self.print_lines(list, &program.layouts, Layout::print_fields);
            }
            ProgramList::Variables => {
                self.print_lines(list, &program.variables, Variable::print_fields);
            }
            ProgramList::Modules => {
                self.print_lines(list, &program.modules, Module::print_fields);
            }
            ProgramList::ModuleFailures => {
                self.print_lines(list, &program.module_failures, ModuleFailure::print_fields);
            }
            ProgramList::EvalScopes => {
                self.print_lines(list, &program.eval_scopes, EvalScope::print_fields);
            }
            ProgramList::Functions => {
                self.print_lines(list, &program.functions, Function::print_fields);
            }
            ProgramList::Data => {
                self.print_lines(list, &program.data, Data::print_fields);
            }
            ProgramList::Entries => {
                self.print_lines(list, &program.entries, Entry::print_fields);
            }
            ProgramList::RuntimeFunctions => {
                self.print_lines(
                    list,
                    &program.runtime_functions,
                    RuntimeFunctionEntry::print_fields,
                );
            }
            ProgramList::WebAssemblyModules => {
                self.print_lines(
                    list,
                    &program.web_assembly_modules,
                    WebAssemblyModule::print_fields,
                );
            }
            _ => debug_assert!(list.keyword().is_none()),
        }
    }
}

pub fn print_program(program: &Program) -> String {
    let mut out = String::new();
    let mut printer = Printer::new(program.name_tables(), &mut out);
    for list in ProgramList::ALL {
        printer.print_list(program, list);
    }
    out
}

pub fn print_function(
    names: NameTables<'_>,
    id: FunctionId,
    function: &Function,
    out: &mut String,
) {
    let keyword = ProgramList::Functions.keyword();
    let _ = write!(
        out,
        "{} {id}",
        keyword.expect("functions print on their own")
    );
    debug_assert_eq!(ProgramList::Functions.prefix(), Some(FunctionId::PREFIX));
    function.print_fields(&mut Printer::new(names, out));
    out.push('\n');
}
