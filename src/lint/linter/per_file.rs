//! What the linter keeps about the file that is linted.

use super::comment::{parse_list_config, parse_string_config};
use super::directives::{self, ConfigComment, Label};
use super::globals::{CommentGlobal, CommentVariables, Tables};
use crate::ast::File;
use crate::language::Global;
use std::borrow::Cow;
use std::cell::{Cell, OnceCell};

/// Computed on demand, once.
#[derive(Default)]
pub(crate) struct PerFile {
    /// Comments configure nothing: `noInlineConfig`, `--no-inline-config`.
    ignores_comments: Cell<bool>,
    comments: OnceCell<Vec<ConfigComment>>,
    variables: OnceCell<CommentVariables>,
}

/// The part of ESLint's `applyInlineConfig` that is about variables.
fn variables_in(file: &File, comments: &[ConfigComment]) -> CommentVariables {
    let mut variables = CommentVariables::default();
    for comment in comments {
        let value = file.slice(comment.value);
        match comment.label {
            Label::Env => {
                let Some(eslint_8) = &file.language().eslint_8 else {
                    continue;
                };
                for name in parse_list_config(value) {
                    let of_plugin = eslint_8.globals_of_environment(name);
                    let of_plugin = of_plugin.map(|it| (Cow::Owned(it.0.to_vec()), it.1));
                    variables.of_environments.extend(of_plugin);
                    let name: &[u8] = if name == b"es6" { b"es2015" } else { name };
                    let all = super::globals::environment(name, Tables::Eslint8);
                    let all = all.into_iter().flatten();
                    let all = all.map(|it| (Cow::Borrowed(it.0), it.1));
                    variables.of_environments.extend(all);
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
    /// Comments of the file configure nothing from now on.
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

    fn comment_variables(&'a self) -> Option<&'a CommentVariables> {
        let per_file = &self.lazy.linter;
        (!per_file.ignores_comments.get()).then(|| {
            per_file
                .variables
                .get_or_init(|| variables_in(self, self.config_comments()))
        })
    }

    /// The variables that `/* global */` comments of the file name, in the order they are first
    /// named: those for which ESLint's `variable.eslintExplicitGlobal` is set, and those that a
    /// comment turns off.
    pub fn globals_in_comments(&'a self) -> &'a [CommentGlobal] {
        self.comment_variables().map_or(&[], |it| &it.globals)
    }

    /// The one of [`File::globals_in_comments`] that is called `name`.
    pub fn global_in_comments(&'a self, name: &[u8]) -> Option<&'a CommentGlobal> {
        let variables = self.comment_variables()?;
        variables
            .globals
            .get(*variables.global_by_name.get(name)? as usize)
    }

    /// What `name` is in an environment that an `/* eslint-env */` comment of the file names.
    pub(crate) fn global_of_environment_in_comments(&'a self, name: &[u8]) -> Option<Global> {
        self.comment_variables()?.of_environments.get(name).copied()
    }

    /// The names in the `/* exported */` comments of the file.
    pub fn exported_in_comments(&'a self) -> &'a [Box<[u8]>] {
        self.comment_variables().map_or(&[], |it| &it.exported)
    }

    /// Whether `name` is one of [`File::exported_in_comments`].
    pub fn is_exported_in_comments(&'a self, name: &[u8]) -> bool {
        self.comment_variables()
            .is_some_and(|it| it.is_exported.contains(name))
    }
}
