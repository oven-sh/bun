//! JSX configuration: what each source states (`Stated`, `Sources`) and the `Pragma` they give.

use bun_core::strings;
use std::sync::Arc;

/// The transpiler cache hashes the discriminant.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Runtime {
    #[default]
    Automatic = 1,
    Classic = 2,
}

/// Port of `options.JSX.RuntimeDevelopmentPair`.
#[derive(Debug, Clone, Copy)]
pub struct RuntimeDevelopmentPair {
    pub runtime: Runtime,
    pub development: Option<bool>,
}

bun_core::comptime_string_map! {
    pub static RUNTIME_MAP: RuntimeDevelopmentPair = {
        b"classic" => RuntimeDevelopmentPair { runtime: Runtime::Classic, development: None },
        b"automatic" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: None },
        b"react" => RuntimeDevelopmentPair { runtime: Runtime::Classic, development: None },
        // TypeScript: "react-jsx" selects jsx/jsxs (production), "react-jsxdev" selects jsxDEV.
        b"react-jsx" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(false) },
        b"react-jsxdev" => RuntimeDevelopmentPair { runtime: Runtime::Automatic, development: Some(true) },
    };
}

/// Member-expression list for `Pragma.{factory,fragment}`.
///
/// Boxing every element (`Box<[Box<[u8]>]>`) made `Pragma::default()` /
/// `Clone` cost ~10 heap allocations and dominated mimalloc samples in the
/// resolver hot path.
///
/// `MemberList` keeps default+clone cheap: the overwhelmingly-common case
/// (`Static`) borrows static names and an explicit override is one `Shared` allocation: both clone as a pointer copy.
///
/// Never empty: the parser reads `factory[0]` without a check.
#[derive(Debug, Clone)]
pub enum MemberList {
    Static(&'static [&'static [u8]]),
    Shared(Arc<[Box<[u8]>]>),
}

impl From<Box<[Box<[u8]>]>> for MemberList {
    #[inline]
    fn from(v: Box<[Box<[u8]>]>) -> Self {
        MemberList::Shared(v.into())
    }
}

impl MemberList {
    #[inline]
    pub(crate) fn len(&self) -> usize {
        match self {
            MemberList::Static(s) => s.len(),
            MemberList::Shared(o) => o.len(),
        }
    }

    #[inline]
    pub(crate) fn get(&self, i: usize) -> Option<&[u8]> {
        match self {
            MemberList::Static(s) => s.get(i).copied(),
            MemberList::Shared(o) => o.get(i).map(|b| &**b),
        }
    }

    #[inline]
    pub fn first(&self) -> Option<&[u8]> {
        self.get(0)
    }

    #[inline]
    pub fn iter(&self) -> MemberListIter<'_> {
        MemberListIter { list: self, i: 0 }
    }

    /// The names between the dots of `text` as a source states them. `None` when it holds none, as `""` and `"."`.
    pub fn stated(text: &[u8], default: &'static [&'static [u8]]) -> Option<MemberList> {
        Pragma::member_list_to_components_if_different(&MemberList::Static(default), text)
    }
}

pub struct MemberListIter<'a> {
    list: &'a MemberList,
    i: usize,
}

impl<'a> Iterator for MemberListIter<'a> {
    type Item = &'a [u8];
    #[inline]
    fn next(&mut self) -> Option<&'a [u8]> {
        let r = self.list.get(self.i)?;
        self.i += 1;
        Some(r)
    }
    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let rem = self.list.len().saturating_sub(self.i);
        (rem, Some(rem))
    }
}

impl<'a> ExactSizeIterator for MemberListIter<'a> {}

const PRODUCTION_MODULE: &[u8] = b"/jsx-runtime";
const DEVELOPMENT_MODULE: &[u8] = b"/jsx-dev-runtime";

/// A JSX import source: `<pkg>` and its two runtime modules. Derived once, shared by every clone, static for "react".
#[derive(Clone, Default)]
pub struct ImportSource(Option<Arc<ImportSourceNames>>);

struct ImportSourceNames {
    /// `<pkg>/jsx-runtime` followed by `<pkg>/jsx-dev-runtime`.
    text: Box<[u8]>,
    package_len: usize,
}

impl ImportSource {
    pub fn new(package: &[u8]) -> ImportSource {
        if package == defaults::PACKAGE_NAME {
            return ImportSource(None);
        }
        let text = [package, PRODUCTION_MODULE, package, DEVELOPMENT_MODULE].concat();
        ImportSource(Some(Arc::new(ImportSourceNames {
            text: text.into_boxed_slice(),
            package_len: package.len(),
        })))
    }

    /// `<pkg>`
    #[inline]
    pub fn package(&self) -> &[u8] {
        match &self.0 {
            Some(names) => &names.text[..names.package_len],
            None => defaults::PACKAGE_NAME,
        }
    }

    /// `<pkg>/jsx-dev-runtime` in development, else `<pkg>/jsx-runtime`.
    #[inline]
    pub fn runtime_module(&self, development: bool) -> &[u8] {
        match (&self.0, development) {
            (Some(names), false) => &names.text[..names.package_len + PRODUCTION_MODULE.len()],
            (Some(names), true) => &names.text[names.package_len + PRODUCTION_MODULE.len()..],
            (None, false) => defaults::IMPORT_SOURCE,
            (None, true) => defaults::IMPORT_SOURCE_DEV,
        }
    }
}

impl std::fmt::Debug for ImportSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(bstr::BStr::new(self.package()), f)
    }
}

/// What one configuration source states about JSX. `None`: the source does not state the option.
#[derive(Clone, Debug, Default)]
pub struct Stated {
    pub runtime: Option<Runtime>,
    pub development: Option<bool>,
    pub factory: Option<MemberList>,
    pub fragment: Option<MemberList>,
    pub import_source: Option<ImportSource>,
    pub side_effects: Option<bool>,
}

impl Stated {
    /// States `development` and nothing else.
    pub const fn of_development(development: bool) -> Stated {
        Stated {
            runtime: None,
            development: Some(development),
            factory: None,
            fragment: None,
            import_source: None,
            side_effects: None,
        }
    }

    /// Whether no option is stated.
    pub fn states_nothing(&self) -> bool {
        let Stated {
            runtime,
            development,
            factory,
            fragment,
            import_source,
            side_effects,
        } = self;
        runtime.is_none()
            && development.is_none()
            && factory.is_none()
            && fragment.is_none()
            && import_source.is_none()
            && side_effects.is_none()
    }

    /// Lays `top` over `self`: option by option, what `top` states wins.
    pub fn lay_over(&mut self, top: &Stated) {
        self.lay(top, &Stated::default());
    }

    /// Lays a tsconfig.json over `self`. It does not decide an option that `user` states.
    pub fn lay_tsconfig_over(&mut self, tsconfig: &Stated, user: &Stated) {
        self.lay(tsconfig, user);
    }

    /// `top` wins option by option, except for an option that `kept` states.
    fn lay(&mut self, top: &Stated, kept: &Stated) {
        fn lay<T: Clone>(below: &mut Option<T>, top: &Option<T>, kept: &Option<T>) {
            if top.is_some() && kept.is_none() {
                below.clone_from(top);
            }
        }
        lay(&mut self.runtime, &top.runtime, &kept.runtime);
        lay(&mut self.development, &top.development, &kept.development);
        lay(&mut self.factory, &top.factory, &kept.factory);
        lay(&mut self.fragment, &top.fragment, &kept.fragment);
        lay(
            &mut self.import_source,
            &top.import_source,
            &kept.import_source,
        );
        lay(
            &mut self.side_effects,
            &top.side_effects,
            &kept.side_effects,
        );
    }
}

/// The user's JSX configuration: one `Stated` per source.
#[derive(Clone, Debug, Default)]
pub struct Sources {
    /// bunfig.toml. `Some` for any bunfig.toml, also one without a JSX key.
    pub bunfig: Option<Stated>,
    /// The `--jsx-*` flags as typed.
    pub flags: Stated,
    /// `Bun.build({ jsx })`. `Some` for every `Bun.build()`.
    pub build: Option<Stated>,
    /// `Some(development)` when a server owns the build: its mode decides `development`.
    pub server_mode: Option<bool>,
}

impl Sources {
    /// Beside any bunfig.toml, JSX is development unless a source says otherwise.
    const BUNFIG_DEFAULT: Stated = Stated::of_development(true);
    /// Any `--jsx-*` flag that takes a value turns development off.
    const FLAGS_DEFAULT: Stated = Stated::of_development(false);
    /// In `Bun.build()`, JSX is development unless a source says otherwise.
    const BUILD_DEFAULT: Stated = Stated::of_development(true);

    /// `--jsx-side-effects` alone states nothing: the flags count once one of them has a value.
    fn flags_have_a_value(&self) -> bool {
        let flags = &self.flags;
        flags.runtime.is_some()
            || flags.factory.is_some()
            || flags.fragment.is_some()
            || flags.import_source.is_some()
    }

    /// No source has a say.
    pub fn is_empty(&self) -> bool {
        self.bunfig.is_none()
            && !self.flags_have_a_value()
            && self.build.is_none()
            && self.server_mode.is_none()
    }

    /// The sources as one layer, each over its default: bunfig.toml, then the flags, `Bun.build()`, the server mode.
    pub fn layer(&self) -> Stated {
        self.laid().0
    }

    /// What the sources state themselves: `layer()` without a `development` that is a default or the mode of a server.
    pub fn stated(&self) -> Stated {
        let (mut stated, states_development) = self.laid();
        if !states_development {
            stated.development = None;
        }
        stated
    }

    /// `layer()`, and whether its `development` is what a source states.
    fn laid(&self) -> (Stated, bool) {
        let mut layer = Stated::default();
        let mut stated_development = None;
        let mut lay = |default: &Stated, source: &Stated| {
            layer.lay_over(default);
            layer.lay_over(source);
            stated_development = source.development.or(stated_development);
        };
        if let Some(bunfig) = &self.bunfig {
            lay(&Self::BUNFIG_DEFAULT, bunfig);
        }
        if self.flags_have_a_value() {
            lay(&Self::FLAGS_DEFAULT, &self.flags);
        }
        if let Some(build) = &self.build {
            lay(&Self::BUILD_DEFAULT, build);
        }
        if let Some(development) = self.server_mode {
            layer.development = Some(development);
            stated_development = None;
        }
        // A later default that says the same leaves the statement in force. One that says another value replaces it.
        let states_development = stated_development.is_some_and(|it| layer.development == Some(it));
        (layer, states_development)
    }
}

/// `Default` and `Clone` never allocate: a stated list or import source is shared.
#[derive(Debug, Clone)]
pub struct Pragma {
    // these need to be arrays
    pub factory: MemberList,
    pub fragment: MemberList,
    pub runtime: Runtime,
    /// Set on a per file basis like this:
    /// /** @jsxImportSource @emotion/core */
    pub import_source: ImportSource,

    /// Configuration Priority:
    /// - `--define=process.env.NODE_ENV=...`
    /// - `NODE_ENV=...`
    /// - tsconfig.json's `compilerOptions.jsx` (`react-jsx` or `react-jsxdev`)
    pub development: bool,
    pub parse: bool,
    pub side_effects: bool,
}

impl Default for Pragma {
    #[inline]
    fn default() -> Self {
        Pragma::resolve(&[])
    }
}

/// Fills in the defaults: the one place that knows them.
impl From<Stated> for Pragma {
    fn from(stated: Stated) -> Pragma {
        Pragma {
            factory: stated
                .factory
                .unwrap_or(MemberList::Static(defaults::FACTORY)),
            fragment: stated
                .fragment
                .unwrap_or(MemberList::Static(defaults::FRAGMENT)),
            runtime: stated.runtime.unwrap_or(Runtime::Automatic),
            import_source: stated.import_source.unwrap_or_default(),
            development: stated.development.unwrap_or(true),
            parse: true,
            side_effects: stated.side_effects.unwrap_or(false),
        }
    }
}

impl Pragma {
    /// The `Pragma` of `layers`, lowest rank first: the last layer that states an option wins.
    pub fn resolve(layers: &[&Stated]) -> Pragma {
        let mut stated = Stated::default();
        for layer in layers {
            stated.lay_over(layer);
        }
        Pragma::from(stated)
    }

    pub fn hash_for_runtime_transpiler(&self, hasher: &mut bun_wyhash::Wyhash) {
        // Uses `bun_wyhash::Wyhash` (the algorithm behind `bun.hash`) — distinct
        // from `Wyhash11`, which would yield a different cache key.
        for factory in self.factory.iter() {
            hasher.update(factory);
        }
        for fragment in self.fragment.iter() {
            hasher.update(fragment);
        }
        hasher.update(self.import_source.package());
        // `runtime` selects classic vs automatic emission; `development`
        // selects `jsx` vs `jsxDEV`. Both shape transpiled output.
        hasher.update(&[self.runtime as u8, self.development as u8]);
    }

    /// The runtime module of the automatic runtime.
    pub fn import_source(&self) -> &[u8] {
        self.import_source.runtime_module(self.development)
    }

    /// `<pkg>`: the classic import, and where `createElement` comes from for a `key` after a spread.
    pub fn package_name(&self) -> &[u8] {
        self.import_source.package()
    }

    pub fn set_import_source(&mut self, package: &[u8]) {
        self.import_source = ImportSource::new(package);
    }

    /// `"React.createElement"` => `["React", "createElement"]`, or a copy of
    /// `original` (no allocation for `Static`) when `new` names the same
    /// members. `None` when `new` has no members, for example `"."`.
    pub fn member_list_to_components_if_different(
        original: &MemberList,
        new: &[u8],
    ) -> Option<MemberList> {
        strings::tokenize(new, b".").next()?;

        if strings::tokenize(new, b".").eq(original.iter()) {
            return Some(original.clone());
        }

        Some(MemberList::Shared(
            strings::tokenize(new, b".").map(Box::from).collect(),
        ))
    }
}

// Threads share the values that hold these: transform options, tsconfig.json files, bundle options.
const _: fn() = || {
    fn is_shared<T: Send + Sync>() {}
    is_shared::<Stated>();
    is_shared::<Sources>();
    is_shared::<Pragma>();
};

/// Default JSX factory/fragment/import-source values.
pub mod defaults {
    pub const FACTORY: &[&[u8]] = &[b"React", b"createElement"];
    pub const FRAGMENT: &[&[u8]] = &[b"React", b"Fragment"];
    pub const PACKAGE_NAME: &[u8] = b"react";
    pub const IMPORT_SOURCE_DEV: &[u8] = b"react/jsx-dev-runtime";
    pub const IMPORT_SOURCE: &[u8] = b"react/jsx-runtime";
}
pub use defaults as Defaults;

#[cfg(test)]
mod tests {
    use super::*;
    use bstr::BStr;

    fn members(names: &[&[u8]]) -> Option<MemberList> {
        Some(MemberList::Shared(
            names.iter().map(|name| Box::from(*name)).collect(),
        ))
    }

    fn dotted(list: &MemberList) -> String {
        let names: Vec<String> = list
            .iter()
            .map(|name| BStr::new(name).to_string())
            .collect();
        names.join(".")
    }

    fn show(pragma: &Pragma) -> String {
        format!(
            "{:?} development={} side_effects={} {} {} {} {}",
            pragma.runtime,
            pragma.development,
            pragma.side_effects,
            dotted(&pragma.factory),
            dotted(&pragma.fragment),
            BStr::new(pragma.import_source()),
            BStr::new(pragma.package_name()),
        )
    }

    const DEFAULT: &str = "Automatic development=true side_effects=false React.createElement \
                           React.Fragment react/jsx-dev-runtime react";

    #[test]
    fn resolve_of_no_statement_is_the_defaults() {
        assert_eq!(show(&Pragma::resolve(&[])), DEFAULT);
        assert_eq!(show(&Pragma::default()), DEFAULT);
        assert_eq!(show(&Pragma::resolve(&[&Stated::default()])), DEFAULT);
        assert!(Pragma::default().parse);
    }

    #[test]
    fn resolve_takes_the_last_layer_that_states_an_option() {
        let low = Stated {
            runtime: Some(Runtime::Classic),
            development: Some(false),
            factory: members(&[b"low"]),
            import_source: Some(ImportSource::new(b"low")),
            ..Default::default()
        };
        let middle = Stated {
            factory: members(&[b"middle"]),
            fragment: members(&[b"middle", b"F"]),
            ..Default::default()
        };
        let high = Stated {
            development: Some(true),
            side_effects: Some(true),
            ..Default::default()
        };
        assert_eq!(
            show(&Pragma::resolve(&[&low, &middle, &high])),
            "Classic development=true side_effects=true middle middle.F low/jsx-dev-runtime low"
        );
        assert_eq!(
            show(&Pragma::resolve(&[&high, &middle, &low])),
            "Classic development=false side_effects=true low middle.F low/jsx-runtime low"
        );
    }

    #[test]
    fn lay_over_gives_what_resolve_gives_for_the_two_layers() {
        let below = Stated {
            runtime: Some(Runtime::Classic),
            factory: members(&[b"below"]),
            fragment: members(&[b"below"]),
            import_source: Some(ImportSource::new(b"below")),
            ..Default::default()
        };
        let top = Stated {
            development: Some(false),
            fragment: members(&[b"top"]),
            import_source: Some(ImportSource::new(b"top")),
            side_effects: Some(true),
            ..Default::default()
        };
        let mut laid = below.clone();
        laid.lay_over(&top);
        let expected = "Classic development=false side_effects=true below top top/jsx-runtime top";
        assert_eq!(show(&Pragma::resolve(&[&laid])), expected);
        assert_eq!(show(&Pragma::resolve(&[&below, &top])), expected);

        let mut unchanged = below.clone();
        unchanged.lay_over(&Stated::default());
        assert_eq!(
            show(&Pragma::resolve(&[&unchanged])),
            show(&Pragma::resolve(&[&below]))
        );
    }

    #[test]
    fn a_tsconfig_does_not_decide_what_the_user_states() {
        let user = Stated {
            runtime: Some(Runtime::Classic),
            factory: members(&[b"user"]),
            ..Default::default()
        };
        let tsconfig = Stated {
            runtime: Some(Runtime::Automatic),
            development: Some(false),
            factory: members(&[b"tsconfig"]),
            fragment: members(&[b"tsconfig"]),
            import_source: Some(ImportSource::new(b"tsconfig")),
            ..Default::default()
        };
        let mut laid = user.clone();
        laid.lay_tsconfig_over(&tsconfig, &user);
        assert_eq!(
            show(&Pragma::from(laid)),
            "Classic development=false side_effects=false user tsconfig tsconfig/jsx-runtime tsconfig"
        );

        // Beside a user that states nothing it is `lay_over`.
        let mut laid = user.clone();
        laid.lay_tsconfig_over(&tsconfig, &Stated::default());
        assert_eq!(
            show(&Pragma::from(laid)),
            show(&Pragma::resolve(&[&user, &tsconfig]))
        );
    }

    #[test]
    fn import_source_derives_its_names_once() {
        let preact = ImportSource::new(b"preact");
        assert_eq!(preact.package(), b"preact");
        assert_eq!(preact.runtime_module(false), b"preact/jsx-runtime");
        assert_eq!(preact.runtime_module(true), b"preact/jsx-dev-runtime");

        // "react" is the static default.
        assert!(ImportSource::new(b"react").0.is_none());
        assert_eq!(
            ImportSource::default().runtime_module(true),
            b"react/jsx-dev-runtime"
        );

        // A `Pragma` and its clones share the names and the lists of the source that states them.
        let stated = Stated {
            factory: members(&[b"h"]),
            import_source: Some(preact.clone()),
            ..Default::default()
        };
        let copy = Pragma::resolve(&[&stated]).clone();
        assert_eq!(copy.package_name().as_ptr(), preact.package().as_ptr());
        assert_eq!(copy.import_source(), b"preact/jsx-dev-runtime");
        let (Some(MemberList::Shared(stated)), MemberList::Shared(copy)) =
            (&stated.factory, &copy.factory)
        else {
            panic!("a stated factory is shared");
        };
        assert!(Arc::ptr_eq(stated, copy));

        // As a `@jsxImportSource` comment sets it.
        let mut pragma = Pragma::default();
        pragma.set_import_source(b"@emotion/react");
        assert_eq!(pragma.import_source(), b"@emotion/react/jsx-dev-runtime");
        assert_eq!(pragma.package_name(), b"@emotion/react");
    }

    #[test]
    fn sources_lay_each_source_over_its_default() {
        let development = |sources: &Sources| sources.layer().development;
        let classic = Stated {
            runtime: Some(Runtime::Classic),
            ..Default::default()
        };
        let production = Stated::of_development(false);

        assert!(Sources::default().is_empty());
        assert_eq!(development(&Sources::default()), None);

        // Any bunfig.toml, also one without a JSX key, is development unless it says otherwise.
        let mut sources = Sources {
            bunfig: Some(Stated::default()),
            ..Default::default()
        };
        assert!(!sources.is_empty());
        assert_eq!(development(&sources), Some(true));
        sources.bunfig = Some(production.clone());
        assert_eq!(development(&sources), Some(false));

        // A flag with a value turns development off, also over a bunfig.toml that states it.
        sources.bunfig = Some(Stated::of_development(true));
        sources.flags = classic.clone();
        assert_eq!(development(&sources), Some(false));
        assert_eq!(sources.layer().runtime, Some(Runtime::Classic));

        // `Bun.build()` is development unless its `jsx` says otherwise. The mode of a server is over both.
        let mut sources = Sources {
            build: Some(Stated::default()),
            ..Default::default()
        };
        assert_eq!(development(&sources), Some(true));
        sources.build = Some(production);
        assert_eq!(development(&sources), Some(false));
        sources.server_mode = Some(true);
        assert_eq!(development(&sources), Some(true));
    }

    #[test]
    fn sources_state_development_only_where_a_source_names_it() {
        let stated = |sources: &Sources| sources.stated().development;
        let jsxdev = Stated {
            runtime: Some(Runtime::Automatic),
            development: Some(true),
            ..Default::default()
        };
        // A default is not a statement.
        let mut sources = Sources {
            bunfig: Some(Stated::default()),
            ..Default::default()
        };
        assert_eq!(stated(&sources), None);
        sources.bunfig = Some(jsxdev.clone());
        assert_eq!(stated(&sources), Some(true));
        assert_eq!(sources.stated().runtime, Some(Runtime::Automatic));

        // The default of the flags is over what bunfig.toml states.
        sources.flags.import_source = Some(ImportSource::new(b"preact"));
        assert_eq!(stated(&sources), None);
        assert_eq!(sources.layer().development, Some(false));
        assert!(sources.stated().import_source.is_some());
        // A bunfig.toml that states the same as that default still states it.
        sources.bunfig = Some(Stated::of_development(false));
        assert_eq!(stated(&sources), Some(false));

        // The mode of a server is over what `Bun.build()` states.
        let mut sources = Sources {
            build: Some(jsxdev),
            ..Default::default()
        };
        assert_eq!(stated(&sources), Some(true));
        sources.server_mode = Some(false);
        assert_eq!(stated(&sources), None);
        assert_eq!(sources.layer().development, Some(false));
    }

    #[test]
    fn runtime_names_state_development_only_as_react_jsx_and_react_jsxdev() {
        let named: [(&[u8], Runtime, Option<bool>); 5] = [
            (b"classic", Runtime::Classic, None),
            (b"automatic", Runtime::Automatic, None),
            (b"react", Runtime::Classic, None),
            (b"react-jsx", Runtime::Automatic, Some(false)),
            (b"react-jsxdev", Runtime::Automatic, Some(true)),
        ];
        for (name, runtime, development) in named {
            let pair = RUNTIME_MAP.get(name).expect("a runtime");
            assert_eq!((pair.runtime, pair.development), (runtime, development));
        }
        assert!(RUNTIME_MAP.get(b"preserve").is_none());
    }
}
