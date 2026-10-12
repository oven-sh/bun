//! Where the page about a rule is: `docs/lint/rules/<directory>/<name>.mdx`.

use crate::rule::{Meta, Plugin};

impl Plugin {
    /// The directory of the pages about its rules. The rules of `react-hooks` are in that of `react`.
    pub const fn directory_of_docs(self) -> &'static str {
        match self {
            Plugin::Eslint => "eslint",
            Plugin::TypeScript => "typescript",
            Plugin::ReactHooks | Plugin::React => "react",
            Plugin::Import => "import",
            Plugin::Node => "node",
            Plugin::Oxc => "oxc",
            Plugin::Unicorn => "unicorn",
            Plugin::ReactPerf => "react-perf",
            Plugin::JsxA11y => "jsx-a11y",
            Plugin::Nextjs => "nextjs",
            Plugin::Promise => "promise",
            Plugin::Jest => "jest",
            Plugin::Vitest => "vitest",
            Plugin::Jsdoc => "jsdoc",
            Plugin::Vue => "vue",
            Plugin::Bun => "bun",
            Plugin::BunTest => "bun-test",
            Plugin::Prettier => "prettier",
        }
    }
}

impl Meta {
    /// `typescript/no-explicit-any`: the page about the rule, under `docs/lint/rules` and without `.mdx`.
    pub fn page(&self) -> Vec<u8> {
        let directory = self.plugin.directory_of_docs();
        [directory.as_bytes(), b"/", self.name.as_bytes()].concat()
    }

    /// `https://bun.com/docs/lint/rules/typescript/no-explicit-any`
    pub fn docs_url(&self) -> Vec<u8> {
        [&b"https://bun.com/docs/lint/rules/"[..], &self.page()].concat()
    }
}
