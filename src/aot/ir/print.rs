use std::fmt::Write;

use super::body::Body;
use super::generated::{Function, ProgramList};
use super::ids::{FunctionId, Id, PropertyKeyId, StringId, TypeId};
use super::print_body::print_body;
use super::print_names::{print_bytes, print_double, print_property_key, print_string, print_type};
use super::program::{NameTables, Program};

pub struct Printer<'a> {
    pub out: &'a mut String,
    pub names: NameTables<'a>,
}

impl<'a> Printer<'a> {
    pub fn new(names: NameTables<'a>, out: &'a mut String) -> Printer<'a> {
        Printer { out, names }
    }

    pub fn print_string(&mut self, id: StringId) {
        print_string(self, id);
    }

    pub fn print_bytes(&mut self, bytes: &[u8]) {
        print_bytes(self.out, bytes);
    }

    pub fn print_property_key(&mut self, id: PropertyKeyId) {
        print_property_key(self, id);
    }

    pub fn print_type(&mut self, id: TypeId) {
        print_type(self, id);
    }

    pub fn print_double(&mut self, value: f64) {
        print_double(self.out, value);
    }

    pub fn print_body(&mut self, body: &Body) {
        print_body(self, body);
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
                self.print_lines(list, &program.type_sites, |record, printer| {
                    record.print_fields(printer);
                });
            }
            ProgramList::ExpectedResults => {
                self.print_lines(list, &program.expected_results, |record, printer| {
                    record.print_fields(printer);
                });
            }
            ProgramList::Layouts => {
                self.print_lines(list, &program.layouts, |record, printer| {
                    record.print_fields(printer);
                });
            }
            ProgramList::Variables => {
                self.print_lines(list, &program.variables, |record, printer| {
                    record.print_fields(printer);
                });
            }
            ProgramList::Modules => {
                self.print_lines(list, &program.modules, |record, printer| {
                    record.print_fields(printer);
                });
            }
            ProgramList::ModuleFailures => {
                self.print_lines(list, &program.module_failures, |record, printer| {
                    record.print_fields(printer);
                });
            }
            ProgramList::EvalScopes => {
                self.print_lines(list, &program.eval_scopes, |record, printer| {
                    record.print_fields(printer);
                });
            }
            ProgramList::Functions => {
                self.print_lines(list, &program.functions, |record, printer| {
                    record.print_fields(printer);
                });
            }
            ProgramList::Data => {
                self.print_lines(list, &program.data, |record, printer| {
                    record.print_fields(printer);
                });
            }
            ProgramList::Entries => {
                self.print_lines(list, &program.entries, |record, printer| {
                    record.print_fields(printer);
                });
            }
            ProgramList::RuntimeFunctions => {
                self.print_lines(list, &program.runtime_functions, |record, printer| {
                    record.print_fields(printer);
                });
            }
            ProgramList::WebAssemblyModules => {
                self.print_lines(list, &program.web_assembly_modules, |record, printer| {
                    record.print_fields(printer);
                });
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
