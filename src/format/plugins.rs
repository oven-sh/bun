//! Prettier plugins that add a language. Prettier's `inferParser(options, { language })` finds their languages by the
//! word after a code fence and by a `lang` attribute, so a block in one of them can be inside a file that this crate
//! prints. Only the project's own Prettier can print that file: [`PluginLanguages`] records which plugin it needs.

use std::sync::atomic::{AtomicU8, Ordering};

/// A Prettier plugin that adds a language.
pub struct LanguagePlugin {
    /// The package name.
    pub package: &'static [u8],
    /// The endings of the file names it formats. A file with one of them goes to Prettier whole.
    pub endings: &'static [&'static [u8]],
    /// The `name` of each of its `languages`, in lowercase, and their `aliases`, separated by NUL.
    names: &'static [u8],
    /// Their `extensions` without the dot, separated by NUL.
    extensions: &'static [u8],
}

const fn plugin(
    package: &'static [u8],
    endings: &'static [&'static [u8]],
    names: &'static [u8],
    extensions: &'static [u8],
) -> LanguagePlugin {
    LanguagePlugin {
        package,
        endings,
        names,
        extensions,
    }
}

/// Plugins that add a language to Prettier. The rest of a project is formatted the same without them. `names` and
/// `extensions` are the `languages` that each plugin published in this version: prettier-plugin-astro
/// 1.1.2, @prettier/plugin-pug 3.6.0, @prettier/plugin-php 0.26.0, @prettier/plugin-ruby 4.0.4, @prettier/plugin-xml
/// 3.4.2, prettier-plugin-toml 4.1.0, prettier-plugin-java 2.11.0, prettier-plugin-kotlin 2.1.0, prettier-plugin-sh
/// 0.20.2, prettier-plugin-prisma 5.0.0, prettier-plugin-solidity 2.4.1, prettier-plugin-sql 0.20.0,
/// prettier-plugin-rust 0.1.9, prettier-plugin-nginx 2.0.0, prettier-plugin-ini 1.3.0, prettier-plugin-properties
/// 0.3.1, prettier-plugin-gherkin 4.0.0, prettier-plugin-apex 2.3.0, prettier-plugin-marko 4.1.3, prettier-plugin-ejs
/// 1.0.3, prettier-plugin-elm 0.12.0.
pub const LANGUAGE_PLUGINS: [LanguagePlugin; 21] = [
    plugin(b"prettier-plugin-astro", &[b".astro"], b"astro", b"astro"),
    plugin(b"@prettier/plugin-pug", &[b".pug", b".jade"], b"pug", b"jade\0pug"),
    plugin(
        b"@prettier/plugin-php",
        &[b".php"],
        b"php\0inc\0html+php",
        b"php\0aw\0ctp\0fcgi\0inc\0php3\0php4\0php5\0phps\0phpt\0phtml",
    ),
    plugin(
        b"@prettier/plugin-ruby",
        &[b".rb", b".rake", b".gemspec", b".rbs", b".haml"],
        b"ruby\0rbs\0haml",
        b"arb\0axlsx\0builder\0eye\0fcgi\0gemfile\0gemspec\0god\0jb\0jbuilder\0mspec\0opal\0pluginspec\0podspec\0rabl\0rake\0rb\0rbi\0rbuild\0rbw\0rbx\0ru\0ruby\0thor\0watchr\0rbs\0haml",
    ),
    plugin(
        b"@prettier/plugin-xml",
        &[b".xml", b".svg", b".xsd", b".xsl", b".xslt", b".wsdl"],
        b"ant build system\0collada\0eagle\0genshi\0xml+genshi\0xml+kid\0jetbrains mps\0mps\0labview\0maven pom\0svg\0web ontology language\0xml\0rss\0xsd\0wsdl\0xml property list\0xpages\0xproc\0xslt\0xsl",
        b"dae\0sch\0brd\0kid\0mps\0mpl\0msd\0lvproj\0lvclass\0lvlib\0svg\0owl\0adml\0admx\0ant\0axaml\0axml\0builds\0ccproj\0ccxml\0clixml\0cproject\0cscfg\0csdef\0csl\0csproj\0ct\0depproj\0dita\0ditamap\0ditaval\0dll.config\0dotsettings\0filters\0fsproj\0fxml\0glade\0gml\0gmx\0gpx\0grxml\0gst\0hzp\0iml\0inx\0ivy\0jelly\0jsproj\0kml\0launch\0mdpolicy\0mjml\0mm\0mod\0mojo\0mxml\0natvis\0ncl\0ndproj\0nproj\0nuspec\0odd\0osm\0pkgproj\0pluginspec\0proj\0props\0ps1xml\0psc1\0pt\0qhelp\0rdf\0res\0resx\0rs\0rss\0runsettings\0scxml\0sfproj\0shproj\0slnx\0srdf\0storyboard\0sublime-snippet\0sw\0targets\0tml\0typ\0ui\0urdf\0ux\0vbproj\0vcxproj\0vsixmanifest\0vssettings\0vstemplate\0vxml\0wixproj\0workflow\0wsdl\0wsf\0wxi\0wxl\0wxs\0x3d\0xacro\0xaml\0xib\0xlf\0xliff\0xmi\0xml\0xml.dist\0xmp\0xproj\0xsd\0xspec\0xul\0zcml\0plist\0stTheme\0tmCommand\0tmLanguage\0tmPreferences\0tmSnippet\0tmTheme\0xsp-config\0xsp.metadata\0xpl\0xproc\0xslt\0xsl",
    ),
    plugin(b"prettier-plugin-toml", &[b".toml"], b"toml", b"toml\0toml.example"),
    plugin(b"prettier-plugin-java", &[b".java"], b"java", b"java"),
    plugin(
        b"prettier-plugin-kotlin",
        &[b".kt", b".kts"],
        b"kotlin",
        b"kt\0ktm\0kts",
    ),
    plugin(
        b"prettier-plugin-sh",
        &[b".sh", b".bash", b".zsh", b"Dockerfile", b".env"],
        b"dockerfile\0Containerfile\0alpine abuild\0abuild\0apkbuild\0codeowners\0gentoo ebuild\0gentoo eclass\0git attributes\0gitattributes\0ignore list\0ignore\0gitignore\0git-ignore\0java properties\0nushell\0nu-script\0nushell-script\0openrc runscript\0openrc\0option list\0opts\0ackrc\0shell\0sh\0shell-script\0bash\0zsh\0envrc\0tcsh\0textmate properties\0tm-properties\0icalendar\0iCal\0pkg-config\0pkgconf\0vcard\0virtual contact file\0electronic business card\0jvmoptions\0hosts\0dotenv\0husky\0nvmrc",
        b"dockerfile\0containerfile\0ebuild\0eclass\0gitignore\0properties\0nu\0sh\0bash\0bats\0cgi\0command\0fcgi\0ksh\0sbatch\0sh.in\0slurm\0tmux\0tool\0trigger\0zsh\0zsh-theme\0tcsh\0csh\0ics\0ical\0pc\0pc.in\0vcf\0vmoptions\0env\0node-version\0nvmrc",
    ),
    plugin(b"prettier-plugin-prisma", &[b".prisma"], b"prisma", b"prisma"),
    plugin(b"prettier-plugin-solidity", &[b".sol"], b"solidity", b"sol"),
    plugin(
        b"prettier-plugin-sql",
        &[b".sql"],
        b"hiveql\0plsql\0plpgsql\0sql\0sqlpl\0tsql",
        b"q\0hql\0pls\0bdy\0ddl\0fnc\0pck\0pkb\0pks\0plb\0plsql\0prc\0spc\0sql\0tpb\0tps\0trg\0vw\0pgsql\0cql\0inc\0mysql\0tab\0udf\0viw\0db2",
    ),
    plugin(b"prettier-plugin-rust", &[b".rs"], b"rust\0rs", b"rs\0rs.in"),
    plugin(
        b"prettier-plugin-nginx",
        &[b".nginx", b".nginxconf"],
        b"nginx\0nginx configuration file",
        b"nginx\0nginxconf\0vhost",
    ),
    plugin(
        b"prettier-plugin-ini",
        &[b".ini"],
        b"altium designer\0altium\0editorconfig\0editor-config\0git config\0gitconfig\0gitmodules\0ini\0dosini\0shellcheck config\0shellcheckrc\0simple file verification\0sfv\0win32 message file\0windows registry entries",
        b"OutJob\0PcbDoc\0PrjPCB\0SchDoc\0editorconfig\0gitconfig\0ini\0cfg\0cnf\0dof\0lektorproject\0prefs\0pro\0properties\0url\0sfv\0mc\0reg",
    ),
    plugin(
        b"prettier-plugin-properties",
        &[b".properties"],
        b"java properties",
        b"properties",
    ),
    plugin(b"prettier-plugin-gherkin", &[b".feature"], b"gherkin", b"feature"),
    plugin(
        b"prettier-plugin-apex",
        &[b".cls", b".trigger", b".apex"],
        b"apex\0apex anonymous",
        b"cls\0trigger\0apex",
    ),
    plugin(b"prettier-plugin-marko", &[b".marko"], b"marko\0markojs", b"marko"),
    plugin(b"prettier-plugin-ejs", &[b".ejs"], b"ejs", b"ejs"),
    plugin(b"prettier-plugin-elm", &[b".elm"], b"elm", b"elm"),
];

const _: () = assert!(
    LANGUAGE_PLUGINS.len() <= 32,
    "PluginLanguages keeps a bit per plugin in a u32, and the needed one in a u8"
);

/// The index of the plugin named `package` in [`LANGUAGE_PLUGINS`].
pub fn index_of(package: &[u8]) -> Option<usize> {
    LANGUAGE_PLUGINS.iter().position(|it| it.package == package)
}

/// True if one of the NUL-separated `words` is `word`.
fn has_word(words: &[u8], word: &[u8]) -> bool {
    !word.is_empty() && bun_core::strings::split(words, b"\0").any(|it| it == word)
}

const NONE: u8 = u8::MAX;

/// The language plugins that the configuration lists for a file, and the one the file turns out to need. The options
/// of everything embedded in the file share it.
#[derive(Debug)]
pub struct PluginLanguages {
    /// A bit per index into [`LANGUAGE_PLUGINS`].
    listed: u32,
    /// The index of the plugin that has a language found in the file, or [`NONE`].
    needed: AtomicU8,
}

impl PluginLanguages {
    /// `listed` has a bit set for each index into [`LANGUAGE_PLUGINS`]. `None` if it has none.
    pub fn new(listed: u32) -> Option<std::sync::Arc<PluginLanguages>> {
        (listed != 0).then(|| {
            std::sync::Arc::new(PluginLanguages {
                listed,
                needed: AtomicU8::new(NONE),
            })
        })
    }

    /// The listed plugins, by index.
    fn listed(&self) -> impl Iterator<Item = usize> {
        (0..LANGUAGE_PLUGINS.len()).filter(move |&at| self.listed & (1 << at) != 0)
    }

    /// The index of the plugin whose language is found in the file, if one is.
    pub fn needed(&self) -> Option<usize> {
        match self.needed.load(Ordering::Relaxed) {
            NONE => None,
            at => Some(at as usize),
        }
    }

    /// The first language found decides. Prettier takes the plugin listed last for a word two of them have, and this
    /// takes the first of the table: the file goes to Prettier either way.
    fn note(&self, at: usize) {
        let _ =
            (self.needed).compare_exchange(NONE, at as u8, Ordering::Relaxed, Ordering::Relaxed);
    }
}

/// Prettier's `inferParser(options, { language })` with the plugins of `options` loaded. If a listed plugin has the
/// language, it is noted in `options.plugin_languages` and the result is `None`: nothing here prints the code.
///
/// Prettier tries names, then aliases, then extensions, each time through the listed plugins before its own languages:
/// `inc` is PHP with `@prettier/plugin-php`, `mjml` stays MJML with `@prettier/plugin-xml`, `wxs` is XML with it.
pub(crate) fn infer_parser_with(
    options: &crate::FormatOptions,
    language: &[u8],
) -> Option<&'static [u8]> {
    let Some(plugins) = &options.plugin_languages else {
        return crate::markdown::infer_parser(language);
    };
    let listed = || plugins.listed().map(|at| (at, &LANGUAGE_PLUGINS[at]));
    let by_name = listed().find(|(_, it)| has_word(it.names, language));
    if by_name.is_none()
        && let Some(parser) = crate::markdown::infer_parser_by_name(language)
    {
        return Some(parser);
    }
    let found = by_name.or_else(|| listed().find(|(_, it)| has_word(it.extensions, language)));
    match found {
        Some((at, _)) => {
            plugins.note(at);
            None
        }
        None => crate::markdown::infer_parser_by_extension(language),
    }
}
