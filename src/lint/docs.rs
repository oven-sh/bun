//! Maps a rule to its docs page, `docs/lint/rules/<directory>/<name>.mdx`.

use crate::rule::{Meta, Plugin};

impl Plugin {
    /// The directory with this plugin's rule pages. `react-hooks` rules share `react`'s directory.
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
    /// The rule's page, relative to `docs/lint/rules` and without `.mdx`, like `typescript/no-explicit-any`.
    pub fn page(&self) -> Vec<u8> {
        let directory = self.plugin.directory_of_docs();
        [directory.as_bytes(), b"/", self.name.as_bytes()].concat()
    }

    /// `https://bun.com/docs/lint/rules/typescript/no-explicit-any`
    pub fn docs_url(&self) -> Vec<u8> {
        [&b"https://bun.com/docs/lint/rules/"[..], &self.page()].concat()
    }
}
