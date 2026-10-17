use core::cell::{Cell, RefCell};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuditedExpression {
    pub next: u32,
    pub start: u32,
    pub id: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuditedParameter {
    pub function: u32,
    pub index: u32,
    pub id: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuditedValidation {
    pub next: u32,
    pub start: u32,
    pub which: u8,
    pub plan: Box<[u8]>,
}

#[derive(Default)]
pub struct AuditedFile {
    pub source_hash: u64,
    pub expressions: Vec<AuditedExpression>,
    pub parameters: Vec<AuditedParameter>,
    pub validations: Vec<AuditedValidation>,
}

impl AuditedFile {
    pub fn sort(&mut self) {
        self.expressions.sort_unstable_by_key(|it| (it.next, core::cmp::Reverse(it.start)));
        self.parameters.sort_unstable_by_key(|it| (it.function, it.index));
        self.validations.sort_unstable_by_key(|it| (it.next, it.start));
    }

    pub fn validation_at(&self, start: u32, next: u32) -> Option<&AuditedValidation> {
        let at = self.validations.binary_search_by_key(&(next, start), |it| (it.next, it.start)).ok()?;
        Some(&self.validations[at])
    }

    pub fn ending_before(&self, next: u32) -> &[AuditedExpression] {
        let from = self.expressions.partition_point(|it| it.next < next);
        let to = from + self.expressions[from..].partition_point(|it| it.next == next);
        &self.expressions[from..to]
    }

    pub fn parameters_of(&self, function: u32) -> &[AuditedParameter] {
        let from = self.parameters.partition_point(|it| it.function < function);
        let to = from + self.parameters[from..].partition_point(|it| it.function == function);
        &self.parameters[from..to]
    }
}

#[derive(Default)]
pub struct PrintedAudit {
    pub expressions: Vec<[u32; 3]>,
    pub parameters: Vec<[u32; 3]>,
}

thread_local! {
    static CURRENT: Cell<Option<&'static AuditedFile>> = const { Cell::new(None) };
    static PRINTED: RefCell<PrintedAudit> = const { RefCell::new(PrintedAudit { expressions: Vec::new(), parameters: Vec::new() }) };
}

pub fn unmarked(mut expr: crate::Expr) -> crate::Expr {
    while let crate::ExprData::ECall(call) = expr.data {
        if !matches!(call.target.data, crate::ExprData::EMissing(..)) {
            break;
        }
        expr = call.args[0];
    }
    expr
}

pub fn set_current(file: Option<&'static AuditedFile>) {
    CURRENT.with(|current| current.set(file));
    PRINTED.with(|printed| *printed.borrow_mut() = PrintedAudit::default());
}

pub fn current() -> Option<&'static AuditedFile> {
    CURRENT.with(Cell::get)
}

type TableSource = fn(&[u8], &[u8]) -> Option<&'static AuditedFile>;

static TABLE_SOURCE: std::sync::OnceLock<TableSource> = std::sync::OnceLock::new();

pub fn set_table_source(source: TableSource) {
    let _ = TABLE_SOURCE.set(source);
}

pub fn is_on() -> bool {
    TABLE_SOURCE.get().is_some()
}

static KEEPS_DIRECTIVES: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn keep_directives() {
    KEEPS_DIRECTIVES.store(true, std::sync::atomic::Ordering::Release);
}

pub fn keeps_directives() -> bool {
    KEEPS_DIRECTIVES.load(std::sync::atomic::Ordering::Acquire)
}

pub fn table_for(path: &[u8], text: &[u8]) -> Option<&'static AuditedFile> {
    let file = TABLE_SOURCE.get()?(path, text);
    set_current(file);
    file
}

pub struct Finished {
    pub written_len: usize,
    pub expressions: Vec<[u32; 6]>,
    pub parameters: Vec<[u32; 6]>,
}

type Finish = fn(&[u8]) -> Option<Box<Finished>>;

static FINISH: std::sync::OnceLock<Finish> = std::sync::OnceLock::new();

pub fn set_finish(finish: Finish) {
    let _ = FINISH.set(finish);
}

pub fn finish(written: &[u8]) -> Option<Box<Finished>> {
    FINISH.get()?(written)
}

pub fn record_printed_expression(start: u32, end: u32, id: u32) {
    PRINTED.with(|printed| printed.borrow_mut().expressions.push([start, end, id]));
}

pub fn record_printed_parameter(function: u32, index: u32, id: u32) {
    PRINTED.with(|printed| printed.borrow_mut().parameters.push([function, index, id]));
}

pub fn take_printed() -> PrintedAudit {
    PRINTED.with(|printed| core::mem::take(&mut *printed.borrow_mut()))
}
