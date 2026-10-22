use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::ast::svelte::KitFileType;
use bun_semver::{SlicedString, Version};

/// One of an eslint-plugin-svelte rule's `meta.conditions`: the rule runs on a component if one of them holds
/// (`shouldRun`). An empty list allows anything.
pub(crate) struct Condition {
    pub svelte_versions: &'static [&'static str],
    /// `svelteFileTypes`: `".svelte"`, `".svelte.[js|ts]"`.
    pub svelte_file_types: &'static [&'static str],
    /// `runes` from svelte-eslint-parser's services ([`File::svelte_runes`]), which is never `'undetermined'` for a
    /// component.
    pub runes: &'static [bool],
    pub kit_file_types: &'static [KitFileType],
    /// `svelteKitVersions`: [`SvelteContext::kit_version`](bun_lint::ast::svelte::SvelteContext::kit_version).
    pub svelte_kit_versions: &'static [&'static str],
}

impl Condition {
    fn holds<'a>(&self, file: &'a File<'a>) -> bool {
        // A file that isn't a component: `getSvelteContext` gives it no SvelteKit file type, runes only for a
        // `.svelte.js` or `.svelte.ts` file, and Svelte 5, which is what the native parser reads.
        let Some(context) = file.svelte_context() else {
            let path = file.path();
            let is_script = path.ends_with(b".svelte.js") || path.ends_with(b".svelte.ts");
            return (self.runes.is_empty() || is_script && self.runes.contains(&true))
                && (self.svelte_file_types.is_empty()
                    || is_script && self.svelte_file_types.contains(&".svelte.[js|ts]"))
                && self.kit_file_types.is_empty()
                && self.svelte_kit_versions.is_empty()
                && (self.svelte_versions.is_empty() || self.svelte_versions.contains(&"5"));
        };
        let version = context.svelte_version.as_deref();
        (self.svelte_versions.is_empty()
            || version.is_some_and(|it| self.svelte_versions.contains(&it)))
            && (self.svelte_file_types.is_empty()
                || version.is_some() && self.svelte_file_types.contains(&".svelte"))
            && (self.kit_file_types.is_empty()
                || (context.kit_file_type).is_some_and(|it| self.kit_file_types.contains(&it)))
            && (self.svelte_kit_versions.is_empty()
                || (context.kit_version.as_deref())
                    .is_some_and(|it| self.svelte_kit_versions.contains(&it)))
            && (self.runes.is_empty()
                || file
                    .svelte_runes()
                    .is_some_and(|it| self.runes.contains(&it)))
    }
}

/// True if a rule with `conditions` runs on `file`.
pub(crate) fn should_run<'a>(file: &'a File<'a>, conditions: &[Condition]) -> bool {
    conditions.is_empty() || conditions.iter().any(|it| it.holds(file))
}

/// `semver.satisfies(VERSION, ">=" + least)` for `file`'s `svelte/compiler`, if its version is known. A prerelease
/// doesn't satisfy it, and neither does a `-` without one, which isn't a version.
pub(crate) fn has_compiler_at_least<'a>(file: &'a File<'a>, least: [u64; 3]) -> bool {
    let Some(version) = file
        .svelte_context()
        .and_then(|it| it.compiler_version.as_deref())
    else {
        return true;
    };
    let version = version.as_bytes();
    let before_build =
        &version[..strings::index_of_char_usize(version, b'+').unwrap_or(version.len())];
    !strings::contains_char(before_build, b'-')
        && Version::parse_exact(SlicedString::init(version, version))
            .is_some_and(|it| [it.major, it.minor, it.patch] >= least)
}
