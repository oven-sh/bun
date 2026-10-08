//! What the linter keeps about the file that is linted.

use super::comment::{parse_list_config, parse_string_config};
use super::directives::{self, ConfigComment, Label};
use super::globals::{CommentGlobal, CommentVariables};
use crate::ast::File;
use crate::language::Global;
use std::cell::{Cell, OnceCell};

/// Computed on demand, once.
#[derive(Default)]
pub(crate) struct PerFile {
    /// Comments configure nothing: `noInlineConfig`, `--no-inline-config`.
    pub(crate) ignores_comments: Cell<bool>,
    comments: OnceCell<Vec<ConfigComment>>,
    variables: OnceCell<CommentVariables>,
}

/// The part of ESLint's `applyInlineConfig` that is about variables.
fn variables_in(file: &File, comments: &[ConfigComment]) -> CommentVariables {
    let mut variables = CommentVariables::default();
    for comment in comments {
        let value = file.slice(comment.value);
        match comment.label {
            Label::Exported => {
                for name in parse_list_config(value) {
                    if !variables.exported.iter().any(|it| **it == *name) {
                        variables.exported.push(name.into());
                    }
                }
            }
            Label::Global => {
                for (name, setting) in parse_string_config(value) {
                    let Some(setting) = setting.map_or(Some(Global::Readonly), |it| Global::of(&it)) else {
                        continue;
                    };
                    match variables.globals.iter_mut().find(|it| *it.name == *name) {
                        Some(global) => {
                            global.setting = setting;
                            global.comments.push(comment.span);
                        }
                        None => variables.globals.push(CommentGlobal {
                            name: name.into(),
                            setting,
                            comments: vec![comment.span],
                        }),
                    }
                }
            }
            _ => {}
        }
    }
    variables
}

impl<'a> File<'a> {
    fn per_file(&self) -> Option<&PerFile> {
        None
    }

    /// Comments of the file configure nothing from now on.
    pub(crate) fn ignore_config_comments(&self) {
        if let Some(per_file) = self.per_file() {
            per_file.ignores_comments.set(true);
        }
    }

    /// ESLint's `getInlineConfigNodes()`.
    pub(crate) fn config_comments(&'a self) -> std::borrow::Cow<'a, [ConfigComment]> {
        match self.per_file() {
            Some(per_file) => (&per_file.comments.get_or_init(|| directives::config_comments(self))[..]).into(),
            None => directives::config_comments(self).into(),
        }
    }

    fn comment_variables(&'a self) -> Option<&'a CommentVariables> {
        let per_file = self.per_file().filter(|it| !it.ignores_comments.get())?;
        Some(per_file.variables.get_or_init(|| variables_in(self, &self.config_comments())))
    }

    /// The variables that `/* global */` comments of the file name, in the order they are first
    /// named: those for which ESLint's `variable.eslintExplicitGlobal` is set, and those that a
    /// comment turns off.
    pub fn globals_in_comments(&'a self) -> &'a [CommentGlobal] {
        self.comment_variables().map_or(&[], |it| &it.globals)
    }

    /// The names in the `/* exported */` comments of the file.
    pub fn exported_in_comments(&'a self) -> &'a [Box<[u8]>] {
        self.comment_variables().map_or(&[], |it| &it.exported)
    }
}
