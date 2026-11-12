mod effects;
mod engine_records;
mod front_end;
mod sink;

use bstr::BStr;
use bun_ast::{Kind, Log, Metadata, Msg};
use bun_sema::check::aot::{DiagnosticClass, Effect};
use bun_sema::messages::Category;
use bun_sema::program::FileId;
use bun_sema_driver::{self as driver, BuildDiagnostic};

use super::{Diagnostics, ProgramView, new_driver_diagnostic};
use crate::compile::Build;

fn text(bytes: &[u8]) -> String {
    BStr::new(bytes).to_string()
}

fn written(diagnostics: Diagnostics) -> Log {
    let mut log = Log::init();
    diagnostics.write_to(&mut log);
    log
}

fn take_diagnostics(build: &mut Build<'_>) -> Diagnostics {
    core::mem::replace(&mut build.diagnostics, Diagnostics::new())
}

fn kinds_and_texts(log: &Log) -> Vec<(Kind, String)> {
    let messages = log.msgs.iter();
    messages
        .map(|message| (message.kind, text(&message.data.text)))
        .collect()
}

fn code_of(message: &Msg) -> u32 {
    match message.metadata {
        Metadata::TypeScript { code, .. } => code,
        Metadata::Build | Metadata::Resolve(_) => 0,
    }
}

fn kinds_and_codes(log: &Log) -> Vec<(Kind, u32)> {
    let messages = log.msgs.iter();
    messages
        .map(|message| (message.kind, code_of(message)))
        .collect()
}

fn describe(log: &Log) -> Vec<String> {
    let describe_message = |message: &Msg| {
        let location = message.data.location.as_ref();
        let position = location.map_or_else(String::new, |location| {
            let file = BStr::new(&location.file);
            format!("{file}:{}:{} ", location.line, location.column)
        });
        format!("{position}{:?} {}", message.kind, text(&message.data.text))
    };
    log.msgs.iter().map(describe_message).collect()
}

fn checker_error(path: &str, position: (u32, u32), code: u32, message: &str) -> driver::Diagnostic {
    driver::Diagnostic {
        path: path.into(),
        has_undefined_range: path.is_empty(),
        line: position.0,
        column: position.1,
        class: DiagnosticClass::Semantic,
        ..new_driver_diagnostic(code, Category::Error, message.into(), &[])
    }
}

fn with_effect(diagnostic: driver::Diagnostic, effect: Effect) -> BuildDiagnostic {
    BuildDiagnostic { diagnostic, effect }
}

fn file_named(view: ProgramView<'_, '_>, path: &str) -> FileId {
    let files = view.files();
    let mut file_ids = (0..files.modules.len()).map(|index| FileId(index as u32));
    file_ids
        .find(|&file| files.module(file).file_name() == path.as_bytes())
        .unwrap_or_else(|| panic!("{path} is not in the program"))
}
