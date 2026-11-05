use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::{Atom, number_to_string};
use bun_sema::bind::{Binding, BindingInitializer, CommonJsVariable, SymbolId};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    BinOp, Branches, CallId, ExprId, ExprKind, MemberKey, NodeData, PropKey, PropKind,
};
use bun_sema::import_sites::{ImportSpecifier, find_values_of_parameter};
use bun_sema::resolve::FinishedFile;
use bun_sema::util::FxHashSet;

use super::{
    Constructor, ContentsScan, is_absolute, read_file_url, resolve_paths, source_path_of,
    with_forward_slashes, with_separators_of_program, worker_builtins, write_file_url,
};
use crate::builtins::{BuiltinId, RuntimeModule, table};
use crate::load::is_host_path;
use crate::load::module_paths::with_separators_of_host;
use crate::module_keys::is_url_with_text;

fn without_separators_of_run(path: Vec<u8>, sees_backslashes: bool) -> Vec<u8> {
    match sees_backslashes {
        true => with_forward_slashes(path),
        false => path,
    }
}

fn join_paths(parts: &[Vec<u8>]) -> Option<Vec<u8>> {
    let written = parts.iter().map(Vec::as_slice);
    let written: Vec<&[u8]> = written.filter(|part| !part.is_empty()).collect();
    let joined = written.join(&b"/"[..]);
    if strings::contains_char(&joined, b'\\') || strings::contains_char(&joined, 0) {
        return None;
    }
    let root_length = match &joined[..] {
        [b'/', ..] => 1,
        path if is_absolute(path) => 3,
        _ => 0,
    };
    let mut segments: Vec<&[u8]> = Vec::new();
    for segment in strings::split(&joined[root_length..], b"/") {
        match segment {
            b"" | b"." => {}
            b".." if segments.last().is_some_and(|&last| last != b"..") => {
                segments.pop();
            }
            b".." if root_length > 0 => {}
            _ => segments.push(segment),
        }
    }
    let mut path = joined[..root_length].to_vec();
    path.extend_from_slice(&segments.join(&b"/"[..]));
    if path.is_empty() {
        path.push(b'.');
    }
    if joined.ends_with(b"/") && !path.ends_with(b"/") {
        path.push(b'/');
    }
    Some(path)
}

fn find_folder(path: &[u8]) -> Option<&[u8]> {
    if !is_absolute(path) {
        return None;
    }
    let root_length = match path.starts_with(b"/") {
        true => 1,
        false => 3,
    };
    let path = match path {
        [named @ .., b'/'] if named.len() >= root_length => named,
        _ => path,
    };
    let last = strings::last_index_of_char(path, b'/')?;
    Some(&path[..last.max(root_length)])
}

impl ContentsScan<'_, '_> {
    pub(super) fn add_code_given_to_worker(
        &mut self,
        argument: ExprId,
        options: Option<ExprId>,
        name: &ImportSpecifier,
    ) {
        let &FinishedFile {
            analysis, atoms, ..
        } = self.request;
        let is_evaluated = options.is_some_and(|options| self.is_told_to_evaluate(options));
        let is_constant = matches!(name, ImportSpecifier::Constant(_));
        let alternatives = analysis.alternatives_of(name).iter();
        let mut texts: Vec<Atom> = alternatives
            .filter_map(|alternative| match *alternative {
                ImportSpecifier::Constant(text) => Some(text),
                _ => None,
            })
            .collect();
        if !is_constant {
            for value in self.find_values_given(argument) {
                let behind_object_url = match is_evaluated {
                    true => None,
                    false => self.find_texts_behind_object_url(value),
                };
                if let Some((held, r#type)) = behind_object_url {
                    let held = held.iter().map(|contents| (atoms.intern(contents), r#type));
                    self.found.texts_behind_object_urls.extend(held);
                } else if let Some(text) = self.find_text(value, &mut Vec::new()) {
                    texts.push(atoms.intern(&text));
                }
            }
        }
        for text in texts {
            if is_evaluated {
                self.found.texts_behind_object_urls.push((text, None));
            } else if is_url_with_text(atoms.bytes(text)) {
                self.found.urls_with_code.push(text);
            }
        }
    }

    fn is_told_to_evaluate(&self, options: ExprId) -> bool {
        let &FinishedFile {
            hir,
            analysis,
            atoms,
            ..
        } = self.request;
        let ExprKind::Object(properties) = hir[self.find_value_under_name(options)].kind else {
            return false;
        };
        let mut properties = properties.iter().map(|property| hir[property]);
        properties.any(|property| {
            let is_named_eval = matches!((property.kind, property.key),
                (PropKind::Init, PropKey::Name(name)) if atoms.bytes(name) == b"eval");
            is_named_eval
                && analysis.decisions.constant(hir, property.value)
                    == FoldedValue::Constant(Constant::Boolean(true))
        })
    }

    fn find_values_given(&self, argument: ExprId) -> Vec<ExprId> {
        let &FinishedFile { hir, analysis, .. } = self.request;
        let mut values = Vec::new();
        let mut followed = FxHashSet::default();
        let mut pending = vec![argument];
        while let Some(expression) = pending.pop() {
            let expression = hir.skip_type_assertions(expression);
            if analysis.decisions.is_dead_expr(expression) || !followed.insert(expression) {
                continue;
            }
            if self.find_constant_text(expression).is_some() {
                values.push(expression);
                continue;
            }
            match hir[expression].kind {
                ExprKind::Cond { branches, .. } => {
                    let Branches { yes, no } = hir.branches(branches);
                    pending.extend([no, yes]);
                }
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish,
                    left,
                    right,
                } => pending.extend([right, left]),
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Comma,
                    right,
                    ..
                } => pending.push(right),
                ExprKind::Await(awaited) => pending.push(awaited),
                ExprKind::Ident(_) => match self.find_symbol_read(expression) {
                    Some(symbol) => pending.extend(self.find_values_held(expression, symbol)),
                    None => values.push(expression),
                },
                _ => values.push(expression),
            }
        }
        values
    }

    fn find_values_held(&self, name: ExprId, symbol: SymbolId) -> Vec<ExprId> {
        let &FinishedFile {
            hir,
            bound,
            analysis,
            ..
        } = self.request;
        if bound.dynamic_lookup_scope(NodeData::Expr(name)).is_some() {
            return Vec::new();
        }
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(value) if bound.is_stable_binding(symbol) => vec![value],
            _ => {
                let passed = find_values_of_parameter(hir, bound, &analysis.decisions, name);
                passed.map_or_else(Vec::new, |passed| passed.to_vec())
            }
        }
    }

    fn find_text(&self, expression: ExprId, names: &mut Vec<SymbolId>) -> Option<Vec<u8>> {
        let &FinishedFile {
            hir,
            analysis,
            atoms,
            ..
        } = self.request;
        let expression = hir.skip_type_assertions(expression);
        match analysis.decisions.constant(hir, expression) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                return match constant {
                    Constant::String(text) => Some(atoms.bytes(text).to_vec()),
                    Constant::Number(number) => Some(number_to_string(number)),
                    Constant::Boolean(value) => Some(value.to_string().into_bytes()),
                    Constant::Null => Some(b"null".to_vec()),
                    Constant::Undefined => Some(b"undefined".to_vec()),
                    Constant::BigInt(_) => None,
                };
            }
            FoldedValue::Unknown => {}
        }
        match hir[expression].kind {
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => {
                let mut text = self.find_text(left, names)?;
                text.append(&mut self.find_text(right, names)?);
                Some(text)
            }
            ExprKind::Template { exprs } => {
                let mut written = hir.ids(hir.template_texts(exprs));
                let mut text = atoms.bytes(written.next()?).to_vec();
                for (substitution, following) in hir.ids(exprs).zip(written) {
                    text.append(&mut self.find_text(substitution, names)?);
                    text.extend_from_slice(atoms.bytes(following));
                }
                Some(text)
            }
            ExprKind::TaggedTemplate(tagged) => self.find_raw_text(tagged, names),
            ExprKind::Ident(_) => self.find_text_under_name(expression, names),
            ExprKind::Call(call) => self.find_text_of_call(call, names),
            ExprKind::New(call) => self.find_href_of_new_url(call, names),
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.find_text_of_member(expression, names)
            }
            _ => None,
        }
    }

    fn find_raw_text(&self, tagged: CallId, names: &mut Vec<SymbolId>) -> Option<Vec<u8>> {
        let &FinishedFile { hir, atoms, .. } = self.request;
        let tag = self.find_builtin_named(hir[tagged].callee)?;
        if tag != worker_builtins().raw_text_maker? {
            return None;
        }
        let mut written = hir.template_parts(hir.template_of(tagged)).iter();
        let mut text = atoms.bytes(written.next()?.raw).to_vec();
        for (substitution, following) in hir.ids(hir[tagged].args).zip(written) {
            text.append(&mut self.find_text(substitution, names)?);
            text.extend_from_slice(atoms.bytes(following.raw));
        }
        Some(text)
    }

    fn find_text_under_name(&self, name: ExprId, names: &mut Vec<SymbolId>) -> Option<Vec<u8>> {
        let &FinishedFile { hir, bound, .. } = self.request;
        if let Binding::CommonJs(variable) = bound.binding(name) {
            return self.find_source_path(name, variable);
        }
        if let Some(separator) = self.find_separator(name) {
            return Some(separator);
        }
        let symbol = self.find_symbol_read(name)?;
        let is_looked_up_at_run_time = bound.dynamic_lookup_scope(NodeData::Expr(name)).is_some();
        if is_looked_up_at_run_time || !bound.is_stable_binding(symbol) || names.contains(&symbol) {
            return None;
        }
        let BindingInitializer::Expression(value) = bound.binding_initializer(hir, symbol) else {
            return None;
        };
        names.push(symbol);
        let text = self.find_text(value, names);
        names.pop();
        text
    }

    fn find_source_path(&self, name: ExprId, variable: CommonJsVariable) -> Option<Vec<u8>> {
        let &FinishedFile {
            path,
            bound,
            analysis,
            ..
        } = self.request;
        let mut stores = bound.runtime.unbound_name_stores().iter();
        let is_stored = stores.any(|&(target, _)| {
            bound.binding(target) == Binding::CommonJs(variable)
                && !analysis.decisions.is_dead_expr(target)
        });
        let is_looked_up_at_run_time = bound.dynamic_lookup_scope(NodeData::Expr(name)).is_some();
        if is_stored || is_looked_up_at_run_time || is_host_path(path) {
            return None;
        }
        let file = source_path_of(path);
        match variable {
            CommonJsVariable::Filename => Some(file),
            CommonJsVariable::Dirname => {
                let folder = find_folder(&with_separators_of_program(&file))?.to_vec();
                Some(with_separators_of_host(&folder, cfg!(windows)))
            }
            CommonJsVariable::Require | CommonJsVariable::Module | CommonJsVariable::Exports => {
                None
            }
        }
    }

    fn find_builtin_named(&self, expression: ExprId) -> Option<BuiltinId> {
        let expression = self.request.hir.skip_type_assertions(expression);
        let builtin = self.find_builtin_that_may_be_named(expression);
        builtin.map(table::canonical_id)
    }

    fn find_export_of(&self, module: Option<RuntimeModule>, expression: ExprId) -> Option<&[u8]> {
        let expression = self.request.hir.skip_type_assertions(expression);
        let export = self.find_export_named(expression, module?)?;
        Some(self.request.atoms.bytes(export))
    }

    fn sees_backslashes(&self) -> Option<bool> {
        let path = (self.input.find_path_at_run_time)()?;
        Some(with_separators_of_program(&path) != path)
    }

    fn find_separator(&self, expression: ExprId) -> Option<Vec<u8>> {
        let export = self.find_export_of(worker_builtins().paths, expression)?;
        match export == b"sep" {
            true => Some(with_separators_of_host(b"/", self.sees_backslashes()?)),
            false => None,
        }
    }

    fn find_text_of_call(&self, call: CallId, names: &mut Vec<SymbolId>) -> Option<Vec<u8>> {
        let &FinishedFile { hir, atoms, .. } = self.request;
        let known = worker_builtins();
        let callee = hir.skip_type_assertions(hir[call].callee);
        let builtin = self.find_builtin_named(callee);
        let mut encoders = known.encoders.iter();
        let encoder = encoders.find(|encoder| builtin.is_some() && encoder.0 == builtin);
        if let Some(&(_, encode)) = encoder {
            return encode(&self.find_text(hir.ids(hir[call].args).next()?, names)?);
        }
        if let Some(function) = self.find_export_of(known.paths, callee) {
            return self.find_path_made(function, call, names);
        }
        if let Some(function) = self.find_export_of(known.urls, callee) {
            return self.find_text_made_of_url(function, call, names);
        }
        match hir.member_key(callee) {
            Some((url, MemberKey::Name(method)))
                if matches!(atoms.bytes(method), b"toString" | b"toJSON") =>
            {
                self.find_href(url, names)
            }
            _ => None,
        }
    }

    fn find_path_made(
        &self,
        function: &[u8],
        call: CallId,
        names: &mut Vec<SymbolId>,
    ) -> Option<Vec<u8>> {
        let hir = self.request.hir;
        let sees_backslashes = self.sees_backslashes()?;
        let parts = hir.ids(hir[call].args).map(|part| {
            let part = self.find_text(part, names)?;
            Some(without_separators_of_run(part, sees_backslashes))
        });
        let parts: Vec<Vec<u8>> = parts.collect::<Option<_>>()?;
        let path = match (function, &parts[..]) {
            (b"join", _) => join_paths(&parts)?,
            (b"resolve", _) => resolve_paths(&parts)?,
            (b"dirname", [path]) => find_folder(path)?.to_vec(),
            _ => return None,
        };
        Some(with_separators_of_host(&path, sees_backslashes))
    }

    fn find_text_made_of_url(
        &self,
        function: &[u8],
        call: CallId,
        names: &mut Vec<SymbolId>,
    ) -> Option<Vec<u8>> {
        let hir = self.request.hir;
        let sees_backslashes = self.sees_backslashes()?;
        let given = self.find_text(hir.ids(hir[call].args).next()?, names)?;
        match function {
            b"fileURLToPath" => {
                let path = read_file_url(&given)?;
                Some(with_separators_of_host(&path, sees_backslashes))
            }
            b"pathToFileURL" => write_file_url(&without_separators_of_run(given, sees_backslashes)),
            _ => None,
        }
    }

    fn find_href_of_new_url(&self, call: CallId, names: &mut Vec<SymbolId>) -> Option<Vec<u8>> {
        let hir = self.request.hir;
        if self.find_constructor_called(call) != Some(Constructor::Url) {
            return None;
        }
        if let Some(url) = self.find_url_of_file_beside(call) {
            return Some(url);
        }
        let mut arguments = hir.ids(hir[call].args);
        let text = self.find_text(arguments.next()?, names)?;
        match arguments.next() {
            Some(base) => {
                let base = self.find_text(base, names)?;
                (self.input.write_url)(&text, Some(&base[..]))
            }
            None => (self.input.write_url)(&text, None),
        }
    }

    fn find_url_of_file_beside(&self, call: CallId) -> Option<Vec<u8>> {
        let name = self.find_file_named_by_own_url(call)?.1;
        let name = self.request.atoms.bytes(name);
        let is_escaped = write_file_url(&[b"/", name].concat())? != [b"file:///", name].concat();
        if is_escaped {
            return None;
        }
        let path = with_separators_of_program(&(self.input.find_path_at_run_time)()?);
        let folder = dirname::<Posix>(&path).to_vec();
        write_file_url(&resolve_paths(&[folder, name.to_vec()])?)
    }

    fn find_href(&self, url: ExprId, names: &mut Vec<SymbolId>) -> Option<Vec<u8>> {
        let hir = self.request.hir;
        let makes_url = match hir[self.find_value_under_name(url)].kind {
            ExprKind::New(call) => self.find_constructor_called(call) == Some(Constructor::Url),
            ExprKind::Call(call) => {
                let function = self.find_export_of(worker_builtins().urls, hir[call].callee);
                function.is_some_and(|function| function == b"pathToFileURL")
            }
            _ => false,
        };
        makes_url.then(|| self.find_text(url, names))?
    }

    fn find_text_of_member(&self, member: ExprId, names: &mut Vec<SymbolId>) -> Option<Vec<u8>> {
        let &FinishedFile {
            hir, bound, atoms, ..
        } = self.request;
        if let Some(separator) = self.find_separator(member) {
            return Some(separator);
        }
        let (object, MemberKey::Name(name)) = hir.member_key(member)? else {
            return None;
        };
        let object = hir.skip_type_assertions(object);
        let name = atoms.bytes(name);
        if !matches!(hir[object].kind, ExprKind::ImportMeta) {
            return match name {
                b"href" => self.find_href(object, names),
                b"pathname" => {
                    let url = self.find_href(object, names)?;
                    let written = url.strip_prefix(b"file://")?;
                    let is_whole = strings::index_of_any(written, b"?#").is_none();
                    (written.starts_with(b"/") && is_whole).then(|| written.to_vec())
                }
                _ => None,
            };
        }
        if bound.import_meta_may_be_modified() {
            return None;
        }
        let path = (self.input.find_path_at_run_time)()?;
        let with_slashes = with_separators_of_program(&path);
        let sees_backslashes = with_slashes != path;
        match name {
            b"path" | b"filename" => Some(path),
            b"dir" | b"dirname" => {
                let folder = dirname::<Posix>(&with_slashes);
                Some(with_separators_of_host(folder, sees_backslashes))
            }
            b"url" => write_file_url(&with_slashes),
            _ => None,
        }
    }

    fn find_texts_behind_object_url(&self, url: ExprId) -> Option<(Vec<Vec<u8>>, Option<Atom>)> {
        let hir = self.request.hir;
        let known = worker_builtins();
        let ExprKind::Call(call) = hir[self.find_value_under_name(url)].kind else {
            return None;
        };
        if self.find_builtin_named(hir[call].callee)? != known.object_url_maker? {
            return None;
        }
        let blob = self.find_value_under_name(hir.ids(hir[call].args).next()?);
        let ExprKind::New(blob) = hir[blob].kind else {
            return None;
        };
        if self.find_builtin_named(hir[blob].callee)? != known.blob_constructor? {
            return None;
        }
        let mut arguments = hir.ids(hir[blob].args);
        let parts = hir.skip_type_assertions(arguments.next()?);
        let ExprKind::Array(parts) = hir[parts].kind else {
            return None;
        };
        let r#type = match arguments.next() {
            Some(options) => self.find_type_of_blob(options)?,
            None => None,
        };
        if parts.len() == 1 {
            let values = self.find_values_given(hir.id_at(parts, 0)).into_iter();
            let texts = values.filter_map(|value| self.find_text(value, &mut Vec::new()));
            return Some((texts.collect(), r#type));
        }
        let mut contents = Vec::new();
        for part in hir.ids(parts) {
            contents.append(&mut self.find_text(part, &mut Vec::new())?);
        }
        Some((vec![contents], r#type))
    }

    fn find_type_of_blob(&self, options: ExprId) -> Option<Option<Atom>> {
        let &FinishedFile { hir, atoms, .. } = self.request;
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(options)].kind else {
            return None;
        };
        let mut r#type = None;
        for property in properties.iter().map(|property| hir[property]) {
            let (PropKind::Init, PropKey::Name(name)) = (property.kind, property.key) else {
                return None;
            };
            if atoms.bytes(name) == b"type" {
                r#type = Some(self.find_constant_text(property.value)?);
            }
        }
        Some(r#type)
    }
}

#[cfg(test)]
mod tests {
    use super::{find_folder, join_paths};

    fn join(parts: &[&str]) -> Option<String> {
        let parts = parts.iter().map(|part| part.as_bytes().to_vec());
        let joined = join_paths(&parts.collect::<Vec<_>>())?;
        Some(String::from_utf8(joined).unwrap())
    }

    #[test]
    fn paths_are_joined_as_node_path_joins_them() {
        let rows: [(&[&str], &str); 9] = [
            (&["/$bunfs/root", "other.js"], "/$bunfs/root/other.js"),
            (&["/a/b", "../c", "./d"], "/a/c/d"),
            (&["/a", "../../b"], "/b"),
            (&["a", "..", ".."], ".."),
            (&["/a/", "b/"], "/a/b/"),
            (&["", ""], "."),
            (&["./"], "./"),
            (&["/"], "/"),
            (&["B:/~BUN/root", "..", "x.js"], "B:/~BUN/x.js"),
        ];
        for (parts, expected) in rows {
            assert_eq!(join(parts).as_deref(), Some(expected), "{parts:?}");
        }
        assert_eq!(join(&["/a", "b\\c"]), None);
    }

    #[test]
    fn folder_of_a_path_ends_at_its_root() {
        let rows: [(&[u8], Option<&[u8]>); 7] = [
            (b"/a/b.js", Some(b"/a")),
            (b"/b.js", Some(b"/")),
            (b"/a/b/", Some(b"/a")),
            (b"/", Some(b"/")),
            (b"B:/~BUN/root/a.js", Some(b"B:/~BUN/root")),
            (b"B:/a.js", Some(b"B:/")),
            (b"a/b.js", None),
        ];
        for (path, expected) in rows {
            assert_eq!(find_folder(path), expected, "{path:?}");
        }
    }
}
