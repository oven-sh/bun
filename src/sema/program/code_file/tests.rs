#![cfg(not(miri))]

mod analysis;
mod import_sites;

use super::*;
use crate::program::code_test_host::{
    HostEvent, ParsePayload, StatementsHost, TestBuild, with_compile_context,
};

fn host_of(files: &'static [(&'static str, &'static str)]) -> StatementsHost {
    StatementsHost {
        files,
        ..StatementsHost::default()
    }
}

fn with_context<R>(
    host: &StatementsHost,
    test: impl FnOnce(&CodeLoadContext<'_, '_, '_>) -> R,
) -> R {
    with_compile_context(&TestBuild::new(host, &[]), test)
}

fn load_with_loader<'s, 'r>(
    context: &CodeLoadContext<'_, 's, 'r>,
    path: &str,
    loader: HostLoader,
) -> ParsedCodeFile<'s, 'r> {
    let target = CodeTarget::of_path(context.resolver.keep(path.as_bytes()), loader);
    let text = context.host.read_source(target.key.path);
    load_code_file(context, context.session.arena(), target, text, false, &[])
}

fn load<'s, 'r>(context: &CodeLoadContext<'_, 's, 'r>, path: &str) -> ParsedCodeFile<'s, 'r> {
    load_with_loader(context, path, HostLoader::default())
}

fn downcast_payload(payload: &Option<HostPayload>) -> &ParsePayload {
    let payload = payload
        .as_deref()
        .expect("the host gives every tree a payload");
    payload.downcast_ref().expect("a payload of the test host")
}

fn parse_payload(path: &str, reads_jsdoc: bool) -> ParsePayload {
    ParsePayload {
        path: path.into(),
        reads_jsdoc,
    }
}

fn parsed_paths(host: &StatementsHost) -> Vec<String> {
    let events = host.events().into_iter();
    let paths = events.filter_map(|event| match event {
        HostEvent::ParsedCode(path) => Some(path),
        _ => None,
    });
    paths.map(|path| path.as_bstr().to_string()).collect()
}
