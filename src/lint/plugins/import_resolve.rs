//! `resolve` of eslint-module-utils: the file that a file means by a name, for the resolvers of
//! `settings["import/resolver"]`.

use bun_lint::modules::Lookup;
use bun_lint::prelude::*;
use bun_lint::utils::node::is_builtin_module;
use smallvec::SmallVec;

/// Those of eslint-import-resolver-node.
const EXTENSIONS: [&[u8]; 4] = [b".mjs", b".js", b".json", b".node"];

/// The resolvers of a file, in their order.
pub(crate) struct Resolvers<'s>(SmallVec<[Lookup<'s>; 2]>);

/// What `resolve` returns.
pub(crate) enum Resolved {
    /// `undefined`
    Nothing,
    /// `null`: a module of Node.js.
    Builtin,
    /// Absolute, separated by `/`.
    File(Vec<u8>),
}

/// `None`: it is not known here.
fn lookup_of<'s>(name: &[u8], config: Option<&'s Json>) -> Option<Lookup<'s>> {
    match name
        .strip_prefix(b"eslint-import-resolver-")
        .unwrap_or(name)
    {
        b"node" => Some(Lookup::Node(
            match config
                .and_then(|it| it.get(b"extensions"))
                .and_then(Json::as_array)
            {
                Some(extensions) => extensions.iter().filter_map(Json::as_str).collect(),
                None => SmallVec::from_slice(&EXTENSIONS),
            },
        )),
        b"typescript" => Some(Lookup::TypeScript),
        _ => None,
    }
}

impl<'s> Resolvers<'s> {
    /// `resolverReducer`
    fn add(&mut self, written: &'s Json) -> Option<()> {
        match written {
            Json::Array(items) => {
                let mut flat = items.iter().filter(|it| it.as_array().is_none());
                flat.try_for_each(|it| self.add(it))
            }
            Json::Object(entries) => entries.iter().try_for_each(|(name, config)| {
                self.0.push(lookup_of(name, Some(config))?);
                Some(())
            }),
            written => {
                self.0.push(lookup_of(written.as_str()?, None)?);
                Some(())
            }
        }
    }

    /// `None`: one of them is not known here, so that nothing can be said about what a name means.
    pub(crate) fn of(settings: &'s Json) -> Option<Resolvers<'s>> {
        let mut resolvers = Resolvers(SmallVec::new());
        match settings.get(b"import/resolver") {
            Some(written) => resolvers.add(written)?,
            None => resolvers.0.extend(lookup_of(b"node", None)),
        }
        Some(resolvers)
    }

    pub(crate) fn resolve(&self, file: &File, specifier: &[u8], is_require: bool) -> Resolved {
        let Some(modules) = file.modules() else {
            return Resolved::Nothing;
        };
        if is_builtin_module(specifier) {
            return Resolved::Builtin;
        }
        let found = self
            .0
            .iter()
            .find_map(|it| modules.resolve_file(file.path(), specifier, is_require, it));
        found.map_or(Resolved::Nothing, Resolved::File)
    }
}
