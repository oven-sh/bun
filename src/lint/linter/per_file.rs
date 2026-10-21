//! Per-file linter state.

use super::comment::{parse_list_config, parse_string_config};
use super::directives::{self, ConfigComment, Label};
use super::globals::{CommentGlobal, CommentVariables, Tables};
use crate::ast::File;
use crate::language::Global;
use crate::languages::JoinedComment;
use crate::span::Span;
use std::borrow::Cow;
use std::cell::{Cell, OnceCell};

/// Each field is computed lazily, once.
#[derive(Default)]
pub(crate) struct PerFile {
    /// True if config comments are ignored (`noInlineConfig`, `--no-inline-config`).
    ignores_comments: Cell<bool>,
    comments: OnceCell<Vec<ConfigComment>>,
    variables: OnceCell<CommentVariables>,
}

/// The variable-related part of ESLint's `applyInlineConfig`.
fn variables_in(file: &File, comments: &[ConfigComment]) -> CommentVariables {
    let mut variables = CommentVariables::default();
    for comment in comments {
        let value = file.slice(comment.value);
        match comment.label {
            Label::Env => {
                // ESLint 9+ rejects this comment. Without a config file it still tells us which globals the file
                // expects.
                let language = file.language();
                let tables = match &language.eslint_8 {
                    Some(_) => Tables::Eslint8,
                    None if language.has_no_foreign_config => Tables::Today,
                    None => continue,
                };
                for name in parse_list_config(value) {
                    let plugin_globals = language.eslint_8.iter();
                    let plugin_globals = plugin_globals.flat_map(|it| it.environment_globals(name));
                    let plugin_globals = plugin_globals.map(|it| (Cow::Owned(it.0.to_vec()), it.1));
                    variables.env_comment_globals.extend(plugin_globals);
                    let name: &[u8] = if name == b"es6" { b"es2015" } else { name };
                    let all = super::globals::environment(name, tables);
                    let all = all.into_iter().flatten();
                    let all = all.map(|it| (Cow::Borrowed(it.0), it.1));
                    variables.env_comment_globals.extend(all);
                }
            }
            Label::Exported => {
                for name in parse_list_config(value) {
                    if variables.is_exported.insert(name.into()) {
                        variables.exported.push(name.into());
                    }
                }
            }
            Label::Global => {
                for (name, setting) in parse_string_config(value) {
                    let Some(setting) =
                        setting.map_or(Some(Global::Readonly), |it| Global::of(&it))
                    else {
                        continue;
                    };
                    let known = variables.global_by_name.get(&name[..]);
                    match known.and_then(|&at| variables.globals.get_mut(at as usize)) {
                        Some(global) => {
                            global.setting = setting;
                            global.comments.push(comment.span);
                        }
                        None => {
                            let at = variables.globals.len() as u32;
                            variables.global_by_name.insert(name.clone().into(), at);
                            variables.globals.push(CommentGlobal {
                                name: name.into(),
                                setting,
                                comments: vec![comment.span],
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }
    variables
}

impl<'a> File<'a> {
    /// Ignores the file's config comments from now on.
    pub(crate) fn ignore_config_comments(&self) {
        self.lazy.linter.ignores_comments.set(true);
    }

    /// ESLint's `getInlineConfigNodes()`.
    pub(crate) fn config_comments(&'a self) -> &'a [ConfigComment] {
        self.lazy
            .linter
            .comments
            .get_or_init(|| directives::config_comments(self))
    }

    /// Returns the comment containing `span`, if that comment is a [`JoinedComment`].
    pub(crate) fn joined_comment(&self, span: Span) -> Option<&'a JoinedComment> {
        let joined = &self.parsed()?.joined;
        joined.iter().find(|it| it.value().contains(span))
    }

    /// Returns the text at `span`, which must be inside a [`ConfigComment`].
    pub(crate) fn slice_of_comment(&self, span: Span) -> &'a [u8] {
        match self.joined_comment(span) {
            Some(joined) => joined
                .text()
                .get(joined.index_of(span.start)..joined.index_of(span.end))
                .unwrap_or_default(),
            None => self.slice(span),
        }
    }

    fn comment_variables(&'a self) -> Option<&'a CommentVariables> {
        let per_file = &self.lazy.linter;
        (!per_file.ignores_comments.get()).then(|| {
            per_file
                .variables
                .get_or_init(|| variables_in(self, self.config_comments()))
        })
    }

    /// Variables listed in the file's `/* global */` comments, in order of first mention. Includes the ones ESLint
    /// marks with `variable.eslintExplicitGlobal` and the ones a comment turns off.
    pub fn globals_in_comments(&'a self) -> &'a [CommentGlobal] {
        self.comment_variables().map_or(&[], |it| &it.globals)
    }

    /// Looks up `name` in [`File::globals_in_comments`].
    pub fn global_in_comments(&'a self, name: &[u8]) -> Option<&'a CommentGlobal> {
        let variables = self.comment_variables()?;
        variables
            .globals
            .get(*variables.global_by_name.get(name)? as usize)
    }

    /// Returns `name`'s setting in the environments listed in the file's `/* eslint-env */` comments.
    pub(crate) fn global_of_environment_in_comments(&'a self, name: &[u8]) -> Option<Global> {
        self.comment_variables()?
            .env_comment_globals
            .get(name)
            .copied()
    }

    /// Globals from the environments listed in the file's `/* eslint-env */` comments, sorted by name.
    pub(crate) fn globals_of_environments_in_comments(&'a self) -> Vec<(&'a [u8], Global)> {
        let Some(variables) = self.comment_variables() else {
            return Vec::new();
        };
        let mut all: Vec<(&'a [u8], Global)> = (variables.env_comment_globals.iter())
            .map(|(name, setting)| (&**name, *setting))
            .collect();
        crate::utils::sort::sort_unstable_by_key(&mut all, |it| it.0);
        all
    }

    /// Names listed in the file's `/* exported */` comments.
    pub fn exported_in_comments(&'a self) -> &'a [Box<[u8]>] {
        self.comment_variables().map_or(&[], |it| &it.exported)
    }

    /// True if `name` is in [`File::exported_in_comments`].
    pub fn is_exported_in_comments(&'a self, name: &[u8]) -> bool {
        self.comment_variables()
            .is_some_and(|it| it.is_exported.contains(name))
    }
}
