use bun_bundler::options::Loader;
use bun_collections::StringHashMap;
use bun_str::strings;

pub use super::mime_type_list_enum::MimeTypeList as Table;

// TODO(port): `Table` variant names in Zig are raw MIME-type strings (e.g. `@"application/json"`),
// which are not valid Rust identifiers. The generated `mime_type_list_enum.rs` must expose either
// mangled variant names or a `const fn from_mime_literal(&'static str) -> Table`. Until then,
// `t!("...")` is a placeholder that resolves to the corresponding `Table` value.
macro_rules! t {
    ($s:literal) => {
        Table::from_mime_literal($s)
    };
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct MimeType {
    // TODO(port): `value` ownership is mixed in Zig (static literal | borrowed input | heap-duped
    // via `init()` allocator). Phase B: change to `Cow<'static, [u8]>` or split owned/borrowed
    // variants. Using `&'static [u8]` for now so the `pub const` items below are expressible.
    pub value: &'static [u8],
    pub category: Category,
}

pub type Map = StringHashMap<Table>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Compact {
    pub value: Table,
}

impl Compact {
    pub fn from(value: Table) -> Compact {
        Compact { value }
    }

    pub fn to_mime_type(self) -> MimeType {
        #[cfg(feature = "ci_assert")]
        {
            if !strings::eql(self.value.slice(), <&'static str>::from(self.value).as_bytes()) {
                bun_core::Output::panic(format_args!(
                    "{} != {}. Code generation is broken.",
                    bstr::BStr::new(self.value.slice()),
                    <&'static str>::from(self.value),
                ));
            }
        }

        // TODO(port): Zig matches on `Table` enum variants directly; we compare against
        // `t!` placeholders because variant idents are not yet defined (see top-of-file note).
        let v = self.value;
        if v == t!("application/webassembly") {
            return WASM;
        }
        if v == t!("application/javascript") {
            return JAVASCRIPT;
        }
        if v == t!("application/json") {
            return JSON;
        }
        if v == t!("application/x-www-form-urlencoded") {
            return Compact::from(t!("application/x-www-form-urlencoded;charset=UTF-8")).to_mime_type();
        }
        if v == t!("image/vnd.microsoft.icon") {
            return ICO;
        }
        if v == t!("text/css") {
            return CSS;
        }
        if v == t!("text/html") {
            return HTML;
        }
        if v == t!("text/javascript") {
            return JAVASCRIPT;
        }
        if v == t!("text/jsx") {
            return JAVASCRIPT;
        }
        if v == t!("text/plain") {
            return TEXT;
        }

        let slice = self.value.slice();
        MimeType {
            value: slice,
            category: Category::from_table(self.value),
        }
    }
}

#[cold]
pub fn create_hash_table() -> Result<Map, bun_alloc::AllocError> {
    let mut map = Map::default();
    map.reserve(Table::ALL.len() as u32 as usize);
    // PERF(port): was put_assume_capacity_no_clobber — profile in Phase B
    for entry in Table::ALL {
        #[cfg(feature = "ci_assert")]
        {
            if !strings::eql(entry.slice(), <&'static str>::from(*entry).as_bytes()) {
                bun_core::Output::panic(format_args!(
                    "{} != {}. Code generation is broken.",
                    bstr::BStr::new(entry.slice()),
                    <&'static str>::from(*entry),
                ));
            }
        }
        map.insert(entry.slice(), *entry);
    }

    Ok(map)
}

impl MimeType {
    pub fn can_open_in_editor(self) -> bool {
        if self.category == Category::Text || self.category.is_code() {
            return true;
        }

        if self.category == Category::Image {
            return self.value == b"image/svg+xml";
        }

        false
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "lowercase")]
pub enum Category {
    None,
    Image,
    Text,
    Html,
    Font,
    Other,
    Css,
    Json,
    Audio,
    Video,
    Javascript,
    Wasm,
    Application,
    Model,
    Message,
    #[strum(serialize = "x-conference")]
    XConference,
    #[strum(serialize = "x-shader")]
    XShader,
    Chemical,
    Multipart,
}

impl Category {
    pub fn from_table(entry: Table) -> Category {
        // TODO(port): see top-of-file note re: Table variant idents.
        if entry == t!("text/javascript")
            || entry == t!("application/javascript")
            || entry == t!("application/javascript; charset=utf-8")
        {
            return Category::Javascript;
        }
        if entry == t!("text/css")
            || entry == t!("text/css;charset=utf-8")
            || entry == t!("text/css; charset=utf-8")
            || entry == t!("text/css; charset=utf8")
            || entry == t!("text/css;charset=utf8")
        {
            return Category::Css;
        }
        if entry == t!("text/html")
            || entry == t!("text/html;charset=utf-8")
            || entry == t!("text/html; charset=utf-8")
            || entry == t!("text/html; charset=utf8")
            || entry == t!("text/html;charset=utf8")
        {
            return Category::Html;
        }
        if entry == t!("application/json")
            || entry == t!("application/json;charset=utf-8")
            || entry == t!("application/json; charset=utf-8")
            || entry == t!("application/json; charset=utf8")
            || entry == t!("application/json;charset=utf8")
        {
            return Category::Json;
        }
        Category::init(entry.slice())
    }

    pub fn init(str: &[u8]) -> Category {
        if let Some(slash) = strings::index_of_char(str, b'/') {
            let category = &str[0..slash as usize];
            let mut after_slash: &[u8] = if str.len() > slash as usize + 1 {
                &str[slash as usize + 1..]
            } else {
                b""
            };

            if let Some(semicolon) = strings::index_of_char(after_slash, b';') {
                after_slash = &after_slash[0..semicolon as usize];
            }

            if category == b"text" {
                if after_slash == b"javascript" {
                    return Category::Javascript;
                }

                if after_slash == b"css" {
                    return Category::Css;
                }

                if after_slash == b"html" {
                    return Category::Html;
                }

                if after_slash == b"json" {
                    return Category::Json;
                }

                return Category::Text;
            }

            if category == b"application" {
                if after_slash == b"wasm" {
                    return Category::Wasm;
                }

                if after_slash == b"javascript" {
                    return Category::Javascript;
                }

                if after_slash == b"json" {
                    return Category::Json;
                }

                if after_slash == b"octet-stream" {
                    return Category::Other;
                }

                return Category::Application;
            }

            if category == b"image" {
                return Category::Image;
            }

            if category == b"video" {
                return Category::Video;
            }

            if category == b"audio" {
                return Category::Audio;
            }

            if category == b"font" {
                return Category::Font;
            }

            if category == b"multipart" {
                return Category::Multipart;
            }

            if category == b"model" {
                return Category::Model;
            }

            if category == b"message" {
                return Category::Message;
            }

            if category == b"x-conference" {
                return Category::XConference;
            }

            if category == b"x-shader" {
                return Category::XShader;
            }

            if category == b"chemical" {
                return Category::Chemical;
            }
        }

        Category::Other
    }

    pub fn is_code(self) -> bool {
        matches!(
            self,
            Category::Wasm | Category::Json | Category::Css | Category::Html | Category::Javascript
        )
    }

    pub fn is_text_like(self) -> bool {
        matches!(
            self,
            Category::Javascript | Category::Html | Category::Text | Category::Css | Category::Json
        )
    }

    pub fn autoset_filename(self) -> bool {
        !matches!(
            self,
            Category::Wasm
                | Category::Font
                | Category::Image
                | Category::Audio
                | Category::Video
                | Category::Javascript
                | Category::Html
                | Category::Text
                | Category::Css
                | Category::Json
        )
    }
}

pub const NONE: MimeType = MimeType::init_comptime(b"", Category::None);
pub const OTHER: MimeType = MimeType::init_comptime(b"application/octet-stream", Category::Other);
pub const CSS: MimeType = MimeType::init_comptime(b"text/css;charset=utf-8", Category::Css);
pub const JAVASCRIPT: MimeType = MimeType::init_comptime(b"text/javascript;charset=utf-8", Category::Javascript);
pub const ICO: MimeType = MimeType::init_comptime(b"image/vnd.microsoft.icon", Category::Image);
pub const HTML: MimeType = MimeType::init_comptime(b"text/html;charset=utf-8", Category::Html);
// we transpile json to javascript so that it is importable without import assertions.
pub const JSON: MimeType = MimeType::init_comptime(b"application/json;charset=utf-8", Category::Json);
pub const TRANSPILED_JSON: MimeType = JAVASCRIPT;
pub const TEXT: MimeType = MimeType::init_comptime(b"text/plain;charset=utf-8", Category::Html);
pub const WASM: MimeType = MimeType::init_comptime(b"application/wasm", Category::Wasm);

impl MimeType {
    const fn init_comptime(str: &'static [u8], t: Category) -> MimeType {
        MimeType {
            value: str,
            category: t,
        }
    }

    pub fn init(str_: &[u8], dupe: bool, allocated: Option<&mut bool>) -> MimeType {
        // PORT NOTE: Zig signature is `(str_, allocator: ?Allocator, allocated: ?*bool)`.
        // Allocator presence == "dupe the input"; replaced with `dupe: bool` (see §Allocators).
        let mut str = str_;
        if let Some(slash) = str.iter().position(|&b| b == b'/') {
            let category_ = &str[0..slash];

            if category_.is_empty() || category_[0] == b'*' || str.len() <= slash + 1 {
                return OTHER;
            }

            str = &str[slash + 1..];

            if let Some(semicolon) = str.iter().position(|&b| b == b';') {
                str = &str[0..semicolon];
            }

            match category_.len() {
                len if len == b"application".len() => {
                    if strings::eql_comptime_ignore_len(category_, b"application") {
                        if str == b"json" || str == b"geo+json" {
                            return JSON;
                        }
                    }

                    if str == b"octet-stream" {
                        return OTHER;
                    }

                    if str == b"wasm" {
                        return WASM;
                    }

                    if let Some(a) = allocated {
                        if dupe {
                            *a = true;
                        }
                    }
                    return MimeType {
                        value: Self::maybe_dupe(str_, dupe),
                        category: Category::Application,
                    };
                }
                len if len == b"font".len() => {
                    if strings::eql_comptime_ignore_len(category_, b"font") {
                        if let Some(a) = allocated {
                            if dupe {
                                *a = true;
                            }
                        }
                        return MimeType {
                            value: Self::maybe_dupe(str_, dupe),
                            category: Category::Font,
                        };
                    }

                    if strings::eql_comptime_ignore_len(category_, b"text") {
                        if str == b"css" {
                            return CSS;
                        }

                        if str == b"html" {
                            return HTML;
                        }

                        if str == b"javascript" {
                            return JAVASCRIPT;
                        }

                        if str == b"plain" {
                            return TEXT;
                        }

                        if let Some(a) = allocated {
                            if dupe {
                                *a = true;
                            }
                        }
                        return MimeType {
                            value: Self::maybe_dupe(str_, dupe),
                            category: Category::Text,
                        };
                    }
                }
                len if len == b"image".len() => {
                    if strings::eql_comptime_ignore_len(category_, b"image") {
                        if let Some(a) = allocated {
                            if dupe {
                                *a = true;
                            }
                        }
                        return MimeType {
                            value: Self::maybe_dupe(str_, dupe),
                            category: Category::Image,
                        };
                    }

                    if strings::eql_comptime_ignore_len(category_, b"audio") {
                        if let Some(a) = allocated {
                            if dupe {
                                *a = true;
                            }
                        }
                        return MimeType {
                            value: Self::maybe_dupe(str_, dupe),
                            category: Category::Audio,
                        };
                    }

                    if strings::eql_comptime_ignore_len(category_, b"video") {
                        if let Some(a) = allocated {
                            if dupe {
                                *a = true;
                            }
                        }
                        return MimeType {
                            value: Self::maybe_dupe(str_, dupe),
                            category: Category::Video,
                        };
                    }
                }
                _ => {}
            }
        }

        if let Some(a) = allocated {
            if dupe {
                *a = true;
            }
        }
        MimeType {
            value: Self::maybe_dupe(str_, dupe),
            category: Category::Other,
        }
    }

    #[inline]
    fn maybe_dupe(s: &[u8], dupe: bool) -> &'static [u8] {
        // TODO(port): see TODO on `value` field. When `dupe` is true, Zig heap-dupes via
        // `allocator.dupe(u8, str_)` and the caller later frees via `deinit()`. When false,
        // the input slice is borrowed. Neither maps to `&'static [u8]`; Phase B must pick
        // `Cow<'static, [u8]>` or a lifetime param. Stub via leak/transmute for now.
        if dupe {
            Box::leak(Box::<[u8]>::from(s))
        } else {
            // SAFETY: NOT actually safe — placeholder. See TODO above.
            unsafe { core::mem::transmute::<&[u8], &'static [u8]>(s) }
        }
    }
}

// TODO: improve this
pub fn by_loader(loader: Loader, ext: &[u8]) -> MimeType {
    match loader {
        Loader::Tsx | Loader::Ts | Loader::Js | Loader::Jsx | Loader::Json => JAVASCRIPT,
        Loader::Css => CSS,
        _ => by_extension(ext),
    }
}

pub fn by_extension(ext_without_leading_dot: &[u8]) -> MimeType {
    by_extension_no_default(ext_without_leading_dot).unwrap_or(OTHER)
}

pub fn by_extension_no_default(ext_without_leading_dot: &[u8]) -> Option<MimeType> {
    if let Some(entry) = EXTENSIONS.get(ext_without_leading_dot) {
        return Some(Compact::from(*entry).to_mime_type());
    }

    None
}

// this is partially auto-generated
pub use super::mime_type_list_enum::MimeTypeList::ALL as ALL;

// TODO: do a comptime static hash map for this
// its too many branches to use ComptimeStringMap
pub fn by_name(name: &[u8]) -> MimeType {
    MimeType::init(name, false, None)
}

// TODO(port): `deinit` in Zig frees `value` via the passed allocator. Tied to the
// `value` ownership decision above; once `value` becomes `Cow`/owned, this becomes `Drop`.
pub fn deinit(_mime_type: MimeType) {
    // no-op placeholder
}

// TODO(port): phf_map! rejects duplicate keys at compile time. The Zig source contains
// duplicate entries for "tsx", "yaml", "yml" (Zig ComptimeStringMap silently kept first).
// Phase B must dedupe.
pub static EXTENSIONS: phf::Map<&'static [u8], Table> = phf::phf_map! {
    b"123" => t!("application/vnd.lotus-1-2-3"),
    b"1km" => t!("application/vnd.1000minds.decision-model+xml"),
    b"3dml" => t!("text/vnd.in3d.3dml"),
    b"3ds" => t!("image/x-3ds"),
    b"3g2" => t!("video/3gpp2"),
    b"3gp" => t!("video/3gpp"),
    b"3gpp" => t!("video/3gpp"),
    b"3mf" => t!("model/3mf"),
    b"7z" => t!("application/x-7z-compressed"),
    b"aab" => t!("application/x-authorware-bin"),
    b"aac" => t!("audio/x-aac"),
    b"aam" => t!("application/x-authorware-map"),
    b"aas" => t!("application/x-authorware-seg"),
    b"abw" => t!("application/x-abiword"),
    b"ac" => t!("application/vnd.nokia.n-gage.ac+xml"),
    b"acc" => t!("application/vnd.americandynamics.acc"),
    b"ace" => t!("application/x-ace-compressed"),
    b"acu" => t!("application/vnd.acucobol"),
    b"acutc" => t!("application/vnd.acucorp"),
    b"adp" => t!("audio/adpcm"),
    b"aep" => t!("application/vnd.audiograph"),
    b"afm" => t!("application/x-font-type1"),
    b"afp" => t!("application/vnd.ibm.modcap"),
    b"age" => t!("application/vnd.age"),
    b"ahead" => t!("application/vnd.ahead.space"),
    b"ai" => t!("application/postscript"),
    b"aif" => t!("audio/x-aiff"),
    b"aifc" => t!("audio/x-aiff"),
    b"aiff" => t!("audio/x-aiff"),
    b"air" => t!("application/vnd.adobe.air-application-installer-package+zip"),
    b"ait" => t!("application/vnd.dvb.ait"),
    b"ami" => t!("application/vnd.amiga.ami"),
    b"amr" => t!("audio/amr"),
    b"apk" => t!("application/vnd.android.package-archive"),
    b"apng" => t!("image/apng"),
    b"appcache" => t!("text/cache-manifest"),
    b"application" => t!("application/x-ms-application"),
    b"apr" => t!("application/vnd.lotus-approach"),
    b"arc" => t!("application/x-freearc"),
    b"arj" => t!("application/x-arj"),
    b"asc" => t!("application/pgp-signature"),
    b"asf" => t!("video/x-ms-asf"),
    b"asm" => t!("text/x-asm"),
    b"aso" => t!("application/vnd.accpac.simply.aso"),
    b"asx" => t!("video/x-ms-asf"),
    b"atc" => t!("application/vnd.acucorp"),
    b"atom" => t!("application/atom+xml"),
    b"atomcat" => t!("application/atomcat+xml"),
    b"atomdeleted" => t!("application/atomdeleted+xml"),
    b"atomsvc" => t!("application/atomsvc+xml"),
    b"atx" => t!("application/vnd.antix.game-component"),
    b"au" => t!("audio/basic"),
    b"avci" => t!("image/avci"),
    b"avcs" => t!("image/avcs"),
    b"avi" => t!("video/x-msvideo"),
    b"avif" => t!("image/avif"),
    b"aw" => t!("application/applixware"),
    b"azf" => t!("application/vnd.airzip.filesecure.azf"),
    b"azs" => t!("application/vnd.airzip.filesecure.azs"),
    b"azv" => t!("image/vnd.airzip.accelerator.azv"),
    b"azw" => t!("application/vnd.amazon.ebook"),
    b"b16" => t!("image/vnd.pco.b16"),
    b"bat" => t!("application/x-msdownload"),
    b"bcpio" => t!("application/x-bcpio"),
    b"bdf" => t!("application/x-font-bdf"),
    b"bdm" => t!("application/vnd.syncml.dm+wbxml"),
    b"bdoc" => t!("application/x-bdoc"),
    b"bed" => t!("application/vnd.realvnc.bed"),
    b"bh2" => t!("application/vnd.fujitsu.oasysprs"),
    b"bin" => t!("application/octet-stream"),
    b"blb" => t!("application/x-blorb"),
    b"blorb" => t!("application/x-blorb"),
    b"bmi" => t!("application/vnd.bmi"),
    b"bmml" => t!("application/vnd.balsamiq.bmml+xml"),
    b"bmp" => t!("image/x-ms-bmp"),
    b"book" => t!("application/vnd.framemaker"),
    b"box" => t!("application/vnd.previewsystems.box"),
    b"boz" => t!("application/x-bzip2"),
    b"bpk" => t!("application/octet-stream"),
    b"bsp" => t!("model/vnd.valve.source.compiled-map"),
    b"btif" => t!("image/prs.btif"),
    b"buffer" => t!("application/octet-stream"),
    b"bz" => t!("application/x-bzip"),
    b"bz2" => t!("application/x-bzip2"),
    b"c" => t!("text/x-c"),
    b"c11amc" => t!("application/vnd.cluetrust.cartomobile-config"),
    b"c11amz" => t!("application/vnd.cluetrust.cartomobile-config-pkg"),
    b"c4d" => t!("application/vnd.clonk.c4group"),
    b"c4f" => t!("application/vnd.clonk.c4group"),
    b"c4g" => t!("application/vnd.clonk.c4group"),
    b"c4p" => t!("application/vnd.clonk.c4group"),
    b"c4u" => t!("application/vnd.clonk.c4group"),
    b"cab" => t!("application/vnd.ms-cab-compressed"),
    b"caf" => t!("audio/x-caf"),
    b"cap" => t!("application/vnd.tcpdump.pcap"),
    b"car" => t!("application/vnd.curl.car"),
    b"cat" => t!("application/vnd.ms-pki.seccat"),
    b"cb7" => t!("application/x-cbr"),
    b"cba" => t!("application/x-cbr"),
    b"cbr" => t!("application/x-cbr"),
    b"cbt" => t!("application/x-cbr"),
    b"cbz" => t!("application/x-cbr"),
    b"cc" => t!("text/x-c"),
    b"cco" => t!("application/x-cocoa"),
    b"cct" => t!("application/x-director"),
    b"ccxml" => t!("application/ccxml+xml"),
    b"cdbcmsg" => t!("application/vnd.contact.cmsg"),
    b"cdf" => t!("application/x-netcdf"),
    b"cdfx" => t!("application/cdfx+xml"),
    b"cdkey" => t!("application/vnd.mediastation.cdkey"),
    b"cdmia" => t!("application/cdmi-capability"),
    b"cdmic" => t!("application/cdmi-container"),
    b"cdmid" => t!("application/cdmi-domain"),
    b"cdmio" => t!("application/cdmi-object"),
    b"cdmiq" => t!("application/cdmi-queue"),
    b"cdx" => t!("chemical/x-cdx"),
    b"cdxml" => t!("application/vnd.chemdraw+xml"),
    b"cdy" => t!("application/vnd.cinderella"),
    b"cer" => t!("application/pkix-cert"),
    b"cfs" => t!("application/x-cfs-compressed"),
    b"cgm" => t!("image/cgm"),
    b"chat" => t!("application/x-chat"),
    b"chm" => t!("application/vnd.ms-htmlhelp"),
    b"chrt" => t!("application/vnd.kde.kchart"),
    b"cif" => t!("chemical/x-cif"),
    b"cii" => t!("application/vnd.anser-web-certificate-issue-initiation"),
    b"cil" => t!("application/vnd.ms-artgalry"),
    b"cjs" => t!("application/javascript"),
    b"cla" => t!("application/vnd.claymore"),
    b"class" => t!("application/java-vm"),
    b"clkk" => t!("application/vnd.crick.clicker.keyboard"),
    b"clkp" => t!("application/vnd.crick.clicker.palette"),
    b"clkt" => t!("application/vnd.crick.clicker.template"),
    b"clkw" => t!("application/vnd.crick.clicker.wordbank"),
    b"clkx" => t!("application/vnd.crick.clicker"),
    b"clp" => t!("application/x-msclip"),
    b"cmc" => t!("application/vnd.cosmocaller"),
    b"cmdf" => t!("chemical/x-cmdf"),
    b"cml" => t!("chemical/x-cml"),
    b"cmp" => t!("application/vnd.yellowriver-custom-menu"),
    b"cmx" => t!("image/x-cmx"),
    b"cod" => t!("application/vnd.rim.cod"),
    b"coffee" => t!("text/coffeescript"),
    b"com" => t!("application/x-msdownload"),
    b"conf" => t!("text/plain"),
    b"cpio" => t!("application/x-cpio"),
    b"cpl" => t!("application/cpl+xml"),
    b"cpp" => t!("text/x-c"),
    b"cpt" => t!("application/mac-compactpro"),
    b"crd" => t!("application/x-mscardfile"),
    b"crl" => t!("application/pkix-crl"),
    b"crt" => t!("application/x-x509-ca-cert"),
    b"crx" => t!("application/x-chrome-extension"),
    b"cryptonote" => t!("application/vnd.rig.cryptonote"),
    b"csh" => t!("application/x-csh"),
    b"csl" => t!("application/vnd.citationstyles.style+xml"),
    b"csml" => t!("chemical/x-csml"),
    b"csp" => t!("application/vnd.commonspace"),
    b"css" => t!("text/css"),
    b"cst" => t!("application/x-director"),
    b"csv" => t!("text/csv"),
    b"cts" => t!("application/javascript"),
    b"cu" => t!("application/cu-seeme"),
    b"curl" => t!("text/vnd.curl"),
    b"cww" => t!("application/prs.cww"),
    b"cxt" => t!("application/x-director"),
    b"cxx" => t!("text/x-c"),
    b"dae" => t!("model/vnd.collada+xml"),
    b"daf" => t!("application/vnd.mobius.daf"),
    b"dart" => t!("application/vnd.dart"),
    b"dataless" => t!("application/vnd.fdsn.seed"),
    b"davmount" => t!("application/davmount+xml"),
    b"dbf" => t!("application/vnd.dbf"),
    b"dbk" => t!("application/docbook+xml"),
    b"dcr" => t!("application/x-director"),
    b"dcurl" => t!("text/vnd.curl.dcurl"),
    b"dd2" => t!("application/vnd.oma.dd2+xml"),
    b"ddd" => t!("application/vnd.fujixerox.ddd"),
    b"ddf" => t!("application/vnd.syncml.dmddf+xml"),
    b"dds" => t!("image/vnd.ms-dds"),
    b"deb" => t!("application/x-debian-package"),
    b"def" => t!("text/plain"),
    b"deploy" => t!("application/octet-stream"),
    b"der" => t!("application/x-x509-ca-cert"),
    b"dfac" => t!("application/vnd.dreamfactory"),
    b"dgc" => t!("application/x-dgc-compressed"),
    b"dic" => t!("text/x-c"),
    b"dir" => t!("application/x-director"),
    b"dis" => t!("application/vnd.mobius.dis"),
    b"disposition-n" => t!("message/disposition-notification"),
    b"dist" => t!("application/octet-stream"),
    b"distz" => t!("application/octet-stream"),
    b"djv" => t!("image/vnd.djvu"),
    b"djvu" => t!("image/vnd.djvu"),
    b"dll" => t!("application/x-msdownload"),
    b"dmg" => t!("application/x-apple-diskimage"),
    b"dmp" => t!("application/vnd.tcpdump.pcap"),
    b"dms" => t!("application/octet-stream"),
    b"dna" => t!("application/vnd.dna"),
    b"doc" => t!("application/msword"),
    b"docm" => t!("application/vnd.ms-word.document.macroenabled.12"),
    b"docx" => t!("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    b"dot" => t!("application/msword"),
    b"dotm" => t!("application/vnd.ms-word.template.macroenabled.12"),
    b"dotx" => t!("application/vnd.openxmlformats-officedocument.wordprocessingml.template"),
    b"dp" => t!("application/vnd.osgi.dp"),
    b"dpg" => t!("application/vnd.dpgraph"),
    b"dra" => t!("audio/vnd.dra"),
    b"drle" => t!("image/dicom-rle"),
    b"dsc" => t!("text/prs.lines.tag"),
    b"dssc" => t!("application/dssc+der"),
    b"dtb" => t!("application/x-dtbook+xml"),
    b"dtd" => t!("application/xml-dtd"),
    b"dts" => t!("audio/vnd.dts"),
    b"dtshd" => t!("audio/vnd.dts.hd"),
    b"dump" => t!("application/octet-stream"),
    b"dvb" => t!("video/vnd.dvb.file"),
    b"dvi" => t!("application/x-dvi"),
    b"dwd" => t!("application/atsc-dwd+xml"),
    b"dwf" => t!("model/vnd.dwf"),
    b"dwg" => t!("image/vnd.dwg"),
    b"dxf" => t!("image/vnd.dxf"),
    b"dxp" => t!("application/vnd.spotfire.dxp"),
    b"dxr" => t!("application/x-director"),
    b"ear" => t!("application/java-archive"),
    b"ecelp4800" => t!("audio/vnd.nuera.ecelp4800"),
    b"ecelp7470" => t!("audio/vnd.nuera.ecelp7470"),
    b"ecelp9600" => t!("audio/vnd.nuera.ecelp9600"),
    b"ecma" => t!("application/ecmascript"),
    b"edm" => t!("application/vnd.novadigm.edm"),
    b"edx" => t!("application/vnd.novadigm.edx"),
    b"efif" => t!("application/vnd.picsel"),
    b"ei6" => t!("application/vnd.pg.osasli"),
    b"elc" => t!("application/octet-stream"),
    b"emf" => t!("image/emf"),
    b"eml" => t!("message/rfc822"),
    b"emma" => t!("application/emma+xml"),
    b"emotionml" => t!("application/emotionml+xml"),
    b"emz" => t!("application/x-msmetafile"),
    b"eol" => t!("audio/vnd.digital-winds"),
    b"eot" => t!("application/vnd.ms-fontobject"),
    b"eps" => t!("application/postscript"),
    b"epub" => t!("application/epub+zip"),
    b"es" => t!("application/ecmascript"),
    b"es3" => t!("application/vnd.eszigno3+xml"),
    b"esa" => t!("application/vnd.osgi.subsystem"),
    b"esf" => t!("application/vnd.epson.esf"),
    b"et3" => t!("application/vnd.eszigno3+xml"),
    b"etx" => t!("text/x-setext"),
    b"eva" => t!("application/x-eva"),
    b"evy" => t!("application/x-envoy"),
    b"exe" => t!("application/x-msdownload"),
    b"exi" => t!("application/exi"),
    b"exp" => t!("application/express"),
    b"exr" => t!("image/aces"),
    b"ext" => t!("application/vnd.novadigm.ext"),
    b"ez" => t!("application/andrew-inset"),
    b"ez2" => t!("application/vnd.ezpix-album"),
    b"ez3" => t!("application/vnd.ezpix-package"),
    b"f" => t!("text/x-fortran"),
    b"f4v" => t!("video/x-f4v"),
    b"f77" => t!("text/x-fortran"),
    b"f90" => t!("text/x-fortran"),
    b"fbs" => t!("image/vnd.fastbidsheet"),
    b"fcdt" => t!("application/vnd.adobe.formscentral.fcdt"),
    b"fcs" => t!("application/vnd.isac.fcs"),
    b"fdf" => t!("application/vnd.fdf"),
    b"fdt" => t!("application/fdt+xml"),
    b"fe_launch" => t!("application/vnd.denovo.fcselayout-link"),
    b"fg5" => t!("application/vnd.fujitsu.oasysgp"),
    b"fgd" => t!("application/x-director"),
    b"fh" => t!("image/x-freehand"),
    b"fh4" => t!("image/x-freehand"),
    b"fh5" => t!("image/x-freehand"),
    b"fh7" => t!("image/x-freehand"),
    b"fhc" => t!("image/x-freehand"),
    b"fig" => t!("application/x-xfig"),
    b"fits" => t!("image/fits"),
    b"flac" => t!("audio/x-flac"),
    b"fli" => t!("video/x-fli"),
    b"flo" => t!("application/vnd.micrografx.flo"),
    b"flv" => t!("video/x-flv"),
    b"flw" => t!("application/vnd.kde.kivio"),
    b"flx" => t!("text/vnd.fmi.flexstor"),
    b"fly" => t!("text/vnd.fly"),
    b"fm" => t!("application/vnd.framemaker"),
    b"fnc" => t!("application/vnd.frogans.fnc"),
    b"fo" => t!("application/vnd.software602.filler.form+xml"),
    b"for" => t!("text/x-fortran"),
    b"fpx" => t!("image/vnd.fpx"),
    b"frame" => t!("application/vnd.framemaker"),
    b"fsc" => t!("application/vnd.fsc.weblaunch"),
    b"fst" => t!("image/vnd.fst"),
    b"ftc" => t!("application/vnd.fluxtime.clip"),
    b"fti" => t!("application/vnd.anser-web-funds-transfer-initiation"),
    b"fvt" => t!("video/vnd.fvt"),
    b"fxp" => t!("application/vnd.adobe.fxp"),
    b"fxpl" => t!("application/vnd.adobe.fxp"),
    b"fzs" => t!("application/vnd.fuzzysheet"),
    b"g2w" => t!("application/vnd.geoplan"),
    b"g3" => t!("image/g3fax"),
    b"g3w" => t!("application/vnd.geospace"),
    b"gac" => t!("application/vnd.groove-account"),
    b"gam" => t!("application/x-tads"),
    b"gbr" => t!("application/rpki-ghostbusters"),
    b"gca" => t!("application/x-gca-compressed"),
    b"gdl" => t!("model/vnd.gdl"),
    b"gdoc" => t!("application/vnd.google-apps.document"),
    b"ged" => t!("text/vnd.familysearch.gedcom"),
    b"geo" => t!("application/vnd.dynageo"),
    b"geojson" => t!("application/geo+json"),
    b"gex" => t!("application/vnd.geometry-explorer"),
    b"ggb" => t!("application/vnd.geogebra.file"),
    b"ggt" => t!("application/vnd.geogebra.tool"),
    b"ghf" => t!("application/vnd.groove-help"),
    b"gif" => t!("image/gif"),
    b"gim" => t!("application/vnd.groove-identity-message"),
    b"glb" => t!("model/gltf-binary"),
    b"gltf" => t!("model/gltf+json"),
    b"gml" => t!("application/gml+xml"),
    b"gmx" => t!("application/vnd.gmx"),
    b"gnumeric" => t!("application/x-gnumeric"),
    b"gph" => t!("application/vnd.flographit"),
    b"gpx" => t!("application/gpx+xml"),
    b"gqf" => t!("application/vnd.grafeq"),
    b"gqs" => t!("application/vnd.grafeq"),
    b"gram" => t!("application/srgs"),
    b"gramps" => t!("application/x-gramps-xml"),
    b"gre" => t!("application/vnd.geometry-explorer"),
    b"grv" => t!("application/vnd.groove-injector"),
    b"grxml" => t!("application/srgs+xml"),
    b"gsf" => t!("application/x-font-ghostscript"),
    b"gsheet" => t!("application/vnd.google-apps.spreadsheet"),
    b"gslides" => t!("application/vnd.google-apps.presentation"),
    b"gtar" => t!("application/x-gtar"),
    b"gtm" => t!("application/vnd.groove-tool-message"),
    b"gtw" => t!("model/vnd.gtw"),
    b"gv" => t!("text/vnd.graphviz"),
    b"gxf" => t!("application/gxf"),
    b"gxt" => t!("application/vnd.geonext"),
    b"gz" => t!("application/gzip"),
    b"h" => t!("text/x-c"),
    b"h261" => t!("video/h261"),
    b"h263" => t!("video/h263"),
    b"h264" => t!("video/h264"),
    b"hal" => t!("application/vnd.hal+xml"),
    b"hbci" => t!("application/vnd.hbci"),
    b"hbs" => t!("text/x-handlebars-template"),
    b"hdd" => t!("application/x-virtualbox-hdd"),
    b"hdf" => t!("application/x-hdf"),
    b"heic" => t!("image/heic"),
    b"heics" => t!("image/heic-sequence"),
    b"heif" => t!("image/heif"),
    b"heifs" => t!("image/heif-sequence"),
    b"hej2" => t!("image/hej2k"),
    b"held" => t!("application/atsc-held+xml"),
    b"hh" => t!("text/x-c"),
    b"hjson" => t!("application/hjson"),
    b"hlp" => t!("application/winhlp"),
    b"hpgl" => t!("application/vnd.hp-hpgl"),
    b"hpid" => t!("application/vnd.hp-hpid"),
    b"hps" => t!("application/vnd.hp-hps"),
    b"hqx" => t!("application/mac-binhex40"),
    b"hsj2" => t!("image/hsj2"),
    b"htc" => t!("text/x-component"),
    b"htke" => t!("application/vnd.kenameaapp"),
    b"htm" => t!("text/html"),
    b"html" => t!("text/html"),
    b"hvd" => t!("application/vnd.yamaha.hv-dic"),
    b"hvp" => t!("application/vnd.yamaha.hv-voice"),
    b"hvs" => t!("application/vnd.yamaha.hv-script"),
    b"i2g" => t!("application/vnd.intergeo"),
    b"icc" => t!("application/vnd.iccprofile"),
    b"ice" => t!("x-conference/x-cooltalk"),
    b"icm" => t!("application/vnd.iccprofile"),
    b"ico" => t!("image/x-icon"),
    b"ics" => t!("text/calendar"),
    b"ief" => t!("image/ief"),
    b"ifb" => t!("text/calendar"),
    b"ifm" => t!("application/vnd.shana.informed.formdata"),
    b"iges" => t!("model/iges"),
    b"igl" => t!("application/vnd.igloader"),
    b"igm" => t!("application/vnd.insors.igm"),
    b"igs" => t!("model/iges"),
    b"igx" => t!("application/vnd.micrografx.igx"),
    b"iif" => t!("application/vnd.shana.informed.interchange"),
    b"img" => t!("application/octet-stream"),
    b"imp" => t!("application/vnd.accpac.simply.imp"),
    b"ims" => t!("application/vnd.ms-ims"),
    b"in" => t!("text/plain"),
    b"ini" => t!("text/plain"),
    b"ink" => t!("application/inkml+xml"),
    b"inkml" => t!("application/inkml+xml"),
    b"install" => t!("application/x-install-instructions"),
    b"iota" => t!("application/vnd.astraea-software.iota"),
    b"ipfix" => t!("application/ipfix"),
    b"ipk" => t!("application/vnd.shana.informed.package"),
    b"irm" => t!("application/vnd.ibm.rights-management"),
    b"irp" => t!("application/vnd.irepository.package+xml"),
    b"iso" => t!("application/x-iso9660-image"),
    b"itp" => t!("application/vnd.shana.informed.formtemplate"),
    b"its" => t!("application/its+xml"),
    b"ivp" => t!("application/vnd.immervision-ivp"),
    b"ivu" => t!("application/vnd.immervision-ivu"),
    b"jad" => t!("text/vnd.sun.j2me.app-descriptor"),
    b"jade" => t!("text/jade"),
    b"jam" => t!("application/vnd.jam"),
    b"jar" => t!("application/java-archive"),
    b"jardiff" => t!("application/x-java-archive-diff"),
    b"java" => t!("text/x-java-source"),
    b"jhc" => t!("image/jphc"),
    b"jisp" => t!("application/vnd.jisp"),
    b"jls" => t!("image/jls"),
    b"jlt" => t!("application/vnd.hp-jlyt"),
    b"jng" => t!("image/x-jng"),
    b"jnlp" => t!("application/x-java-jnlp-file"),
    b"joda" => t!("application/vnd.joost.joda-archive"),
    b"jp2" => t!("image/jp2"),
    b"jpe" => t!("image/jpeg"),
    b"jpeg" => t!("image/jpeg"),
    b"jpf" => t!("image/jpx"),
    b"jpg" => t!("image/jpeg"),
    b"jpg2" => t!("image/jp2"),
    b"jpgm" => t!("video/jpm"),
    b"jpgv" => t!("video/jpeg"),
    b"jph" => t!("image/jph"),
    b"jpm" => t!("video/jpm"),
    b"jpx" => t!("image/jpx"),
    b"js" => t!("application/javascript"),
    b"json" => t!("application/json"),
    b"json5" => t!("application/json5"),
    b"jsonld" => t!("application/ld+json"),
    b"jsonml" => t!("application/jsonml+json"),
    b"jsx" => t!("text/jsx"),
    b"jxr" => t!("image/jxr"),
    b"jxra" => t!("image/jxra"),
    b"jxrs" => t!("image/jxrs"),
    b"jxs" => t!("image/jxs"),
    b"jxsc" => t!("image/jxsc"),
    b"jxsi" => t!("image/jxsi"),
    b"jxss" => t!("image/jxss"),
    b"kar" => t!("audio/midi"),
    b"karbon" => t!("application/vnd.kde.karbon"),
    b"kdbx" => t!("application/x-keepass2"),
    b"key" => t!("application/x-iwork-keynote-sffkey"),
    b"kfo" => t!("application/vnd.kde.kformula"),
    b"kia" => t!("application/vnd.kidspiration"),
    b"kml" => t!("application/vnd.google-earth.kml+xml"),
    b"kmz" => t!("application/vnd.google-earth.kmz"),
    b"kne" => t!("application/vnd.kinar"),
    b"knp" => t!("application/vnd.kinar"),
    b"kon" => t!("application/vnd.kde.kontour"),
    b"kpr" => t!("application/vnd.kde.kpresenter"),
    b"kpt" => t!("application/vnd.kde.kpresenter"),
    b"kpxx" => t!("application/vnd.ds-keypoint"),
    b"ksp" => t!("application/vnd.kde.kspread"),
    b"ktr" => t!("application/vnd.kahootz"),
    b"ktx" => t!("image/ktx"),
    b"ktx2" => t!("image/ktx2"),
    b"ktz" => t!("application/vnd.kahootz"),
    b"kwd" => t!("application/vnd.kde.kword"),
    b"kwt" => t!("application/vnd.kde.kword"),
    b"lasxml" => t!("application/vnd.las.las+xml"),
    b"latex" => t!("application/x-latex"),
    b"lbd" => t!("application/vnd.llamagraphics.life-balance.desktop"),
    b"lbe" => t!("application/vnd.llamagraphics.life-balance.exchange+xml"),
    b"les" => t!("application/vnd.hhe.lesson-player"),
    b"less" => t!("text/less"),
    b"lgr" => t!("application/lgr+xml"),
    b"lha" => t!("application/x-lzh-compressed"),
    b"link66" => t!("application/vnd.route66.link66+xml"),
    b"list" => t!("text/plain"),
    b"list3820" => t!("application/vnd.ibm.modcap"),
    b"listafp" => t!("application/vnd.ibm.modcap"),
    b"litcoffee" => t!("text/coffeescript"),
    b"lnk" => t!("application/x-ms-shortcut"),
    b"log" => t!("text/plain"),
    b"lostxml" => t!("application/lost+xml"),
    b"lrf" => t!("application/octet-stream"),
    b"lrm" => t!("application/vnd.ms-lrm"),
    b"ltf" => t!("application/vnd.frogans.ltf"),
    b"lua" => t!("text/x-lua"),
    b"luac" => t!("application/x-lua-bytecode"),
    b"lvp" => t!("audio/vnd.lucent.voice"),
    b"lwp" => t!("application/vnd.lotus-wordpro"),
    b"lzh" => t!("application/x-lzh-compressed"),
    b"m13" => t!("application/x-msmediaview"),
    b"m14" => t!("application/x-msmediaview"),
    b"m1v" => t!("video/mpeg"),
    b"m21" => t!("application/mp21"),
    b"m2a" => t!("audio/mpeg"),
    b"m2v" => t!("video/mpeg"),
    b"m3a" => t!("audio/mpeg"),
    b"m3u" => t!("audio/x-mpegurl"),
    b"m3u8" => t!("application/vnd.apple.mpegurl"),
    b"m4a" => t!("audio/x-m4a"),
    b"m4p" => t!("application/mp4"),
    b"m4s" => t!("video/iso.segment"),
    b"m4u" => t!("video/vnd.mpegurl"),
    b"m4v" => t!("video/x-m4v"),
    b"ma" => t!("application/mathematica"),
    b"mads" => t!("application/mads+xml"),
    b"maei" => t!("application/mmt-aei+xml"),
    b"mag" => t!("application/vnd.ecowin.chart"),
    b"maker" => t!("application/vnd.framemaker"),
    b"man" => t!("text/troff"),
    b"manifest" => t!("text/cache-manifest"),
    b"map" => t!("application/json"),
    b"mar" => t!("application/octet-stream"),
    b"markdown" => t!("text/markdown"),
    b"mathml" => t!("application/mathml+xml"),
    b"mb" => t!("application/mathematica"),
    b"mbk" => t!("application/vnd.mobius.mbk"),
    b"mbox" => t!("application/mbox"),
    b"mc1" => t!("application/vnd.medcalcdata"),
    b"mcd" => t!("application/vnd.mcd"),
    b"mcurl" => t!("text/vnd.curl.mcurl"),
    b"md" => t!("text/markdown"),
    b"mdb" => t!("application/x-msaccess"),
    b"mdi" => t!("image/vnd.ms-modi"),
    b"mdx" => t!("text/mdx"),
    b"me" => t!("text/troff"),
    b"mesh" => t!("model/mesh"),
    b"meta4" => t!("application/metalink4+xml"),
    b"metalink" => t!("application/metalink+xml"),
    b"mets" => t!("application/mets+xml"),
    b"mfm" => t!("application/vnd.mfmp"),
    b"mft" => t!("application/rpki-manifest"),
    b"mgp" => t!("application/vnd.osgeo.mapguide.package"),
    b"mgz" => t!("application/vnd.proteus.magazine"),
    b"mid" => t!("audio/midi"),
    b"midi" => t!("audio/midi"),
    b"mie" => t!("application/x-mie"),
    b"mif" => t!("application/vnd.mif"),
    b"mime" => t!("message/rfc822"),
    b"mj2" => t!("video/mj2"),
    b"mjp2" => t!("video/mj2"),
    b"mjs" => t!("application/javascript"),
    b"mk3d" => t!("video/x-matroska"),
    b"mka" => t!("audio/x-matroska"),
    b"mkd" => t!("text/x-markdown"),
    b"mks" => t!("video/x-matroska"),
    b"mkv" => t!("video/x-matroska"),
    b"mlp" => t!("application/vnd.dolby.mlp"),
    b"mmd" => t!("application/vnd.chipnuts.karaoke-mmd"),
    b"mmf" => t!("application/vnd.smaf"),
    b"mml" => t!("text/mathml"),
    b"mmr" => t!("image/vnd.fujixerox.edmics-mmr"),
    b"mng" => t!("video/x-mng"),
    b"mny" => t!("application/x-msmoney"),
    b"mobi" => t!("application/x-mobipocket-ebook"),
    b"mods" => t!("application/mods+xml"),
    b"mov" => t!("video/quicktime"),
    b"movie" => t!("video/x-sgi-movie"),
    b"mp2" => t!("audio/mpeg"),
    b"mp21" => t!("application/mp21"),
    b"mp2a" => t!("audio/mpeg"),
    b"mp3" => t!("audio/mpeg"),
    b"mp4" => t!("video/mp4"),
    b"mp4a" => t!("audio/mp4"),
    b"mp4s" => t!("application/mp4"),
    b"mp4v" => t!("video/mp4"),
    b"mpc" => t!("application/vnd.mophun.certificate"),
    b"mpd" => t!("application/dash+xml"),
    b"mpe" => t!("video/mpeg"),
    b"mpeg" => t!("video/mpeg"),
    b"mpf" => t!("application/media-policy-dataset+xml"),
    b"mpg" => t!("video/mpeg"),
    b"mpg4" => t!("video/mp4"),
    b"mpga" => t!("audio/mpeg"),
    b"mpkg" => t!("application/vnd.apple.installer+xml"),
    b"mpm" => t!("application/vnd.blueice.multipass"),
    b"mpn" => t!("application/vnd.mophun.application"),
    b"mpp" => t!("application/vnd.ms-project"),
    b"mpt" => t!("application/vnd.ms-project"),
    b"mpy" => t!("application/vnd.ibm.minipay"),
    b"mqy" => t!("application/vnd.mobius.mqy"),
    b"mrc" => t!("application/marc"),
    b"mrcx" => t!("application/marcxml+xml"),
    b"ms" => t!("text/troff"),
    b"mscml" => t!("application/mediaservercontrol+xml"),
    b"mseed" => t!("application/vnd.fdsn.mseed"),
    b"mseq" => t!("application/vnd.mseq"),
    b"msf" => t!("application/vnd.epson.msf"),
    b"msg" => t!("application/vnd.ms-outlook"),
    b"msh" => t!("model/mesh"),
    b"msi" => t!("application/x-msdownload"),
    b"msl" => t!("application/vnd.mobius.msl"),
    b"msm" => t!("application/octet-stream"),
    b"msp" => t!("application/octet-stream"),
    b"msty" => t!("application/vnd.muvee.style"),
    b"mtl" => t!("model/mtl"),
    b"mts" => t!("application/javascript"),
    b"mtsx" => t!("application/javascript"),
    b"mus" => t!("application/vnd.musician"),
    b"musd" => t!("application/mmt-usd+xml"),
    b"musicxml" => t!("application/vnd.recordare.musicxml+xml"),
    b"mvb" => t!("application/x-msmediaview"),
    b"mvt" => t!("application/vnd.mapbox-vector-tile"),
    b"mwf" => t!("application/vnd.mfer"),
    b"mxf" => t!("application/mxf"),
    b"mxl" => t!("application/vnd.recordare.musicxml"),
    b"mxmf" => t!("audio/mobile-xmf"),
    b"mxml" => t!("application/xv+xml"),
    b"mxs" => t!("application/vnd.triscape.mxs"),
    b"mxu" => t!("video/vnd.mpegurl"),
    b"n-g" => t!("application/vnd.nokia.n-gage.symbian.install"),
    b"n3" => t!("text/n3"),
    b"nb" => t!("application/mathematica"),
    b"nbp" => t!("application/vnd.wolfram.player"),
    b"nc" => t!("application/x-netcdf"),
    b"ncx" => t!("application/x-dtbncx+xml"),
    b"nfo" => t!("text/x-nfo"),
    b"ngdat" => t!("application/vnd.nokia.n-gage.data"),
    b"nitf" => t!("application/vnd.nitf"),
    b"nlu" => t!("application/vnd.neurolanguage.nlu"),
    b"nml" => t!("application/vnd.enliven"),
    b"nnd" => t!("application/vnd.noblenet-directory"),
    b"nns" => t!("application/vnd.noblenet-sealer"),
    b"nnw" => t!("application/vnd.noblenet-web"),
    b"npx" => t!("image/vnd.net-fpx"),
    b"nq" => t!("application/n-quads"),
    b"nsc" => t!("application/x-conference"),
    b"nsf" => t!("application/vnd.lotus-notes"),
    b"nt" => t!("application/n-triples"),
    b"ntf" => t!("application/vnd.nitf"),
    b"numbers" => t!("application/x-iwork-numbers-sffnumbers"),
    b"nzb" => t!("application/x-nzb"),
    b"oa2" => t!("application/vnd.fujitsu.oasys2"),
    b"oa3" => t!("application/vnd.fujitsu.oasys3"),
    b"oas" => t!("application/vnd.fujitsu.oasys"),
    b"obd" => t!("application/x-msbinder"),
    b"obgx" => t!("application/vnd.openblox.game+xml"),
    b"obj" => t!("model/obj"),
    b"oda" => t!("application/oda"),
    b"odb" => t!("application/vnd.oasis.opendocument.database"),
    b"odc" => t!("application/vnd.oasis.opendocument.chart"),
    b"odf" => t!("application/vnd.oasis.opendocument.formula"),
    b"odft" => t!("application/vnd.oasis.opendocument.formula-template"),
    b"odg" => t!("application/vnd.oasis.opendocument.graphics"),
    b"odi" => t!("application/vnd.oasis.opendocument.image"),
    b"odm" => t!("application/vnd.oasis.opendocument.text-master"),
    b"odp" => t!("application/vnd.oasis.opendocument.presentation"),
    b"ods" => t!("application/vnd.oasis.opendocument.spreadsheet"),
    b"odt" => t!("application/vnd.oasis.opendocument.text"),
    b"oga" => t!("audio/ogg"),
    b"ogex" => t!("model/vnd.opengex"),
    b"ogg" => t!("audio/ogg"),
    b"ogv" => t!("video/ogg"),
    b"ogx" => t!("application/ogg"),
    b"omdoc" => t!("application/omdoc+xml"),
    b"onepkg" => t!("application/onenote"),
    b"onetmp" => t!("application/onenote"),
    b"onetoc" => t!("application/onenote"),
    b"onetoc2" => t!("application/onenote"),
    b"opf" => t!("application/oebps-package+xml"),
    b"opml" => t!("text/x-opml"),
    b"oprc" => t!("application/vnd.palm"),
    b"opus" => t!("audio/ogg"),
    b"org" => t!("text/x-org"),
    b"osf" => t!("application/vnd.yamaha.openscoreformat"),
    b"osfpvg" => t!("application/vnd.yamaha.openscoreformat.osfpvg+xml"),
    b"osm" => t!("application/vnd.openstreetmap.data+xml"),
    b"otc" => t!("application/vnd.oasis.opendocument.chart-template"),
    b"otf" => t!("font/otf"),
    b"otg" => t!("application/vnd.oasis.opendocument.graphics-template"),
    b"oth" => t!("application/vnd.oasis.opendocument.text-web"),
    b"oti" => t!("application/vnd.oasis.opendocument.image-template"),
    b"otp" => t!("application/vnd.oasis.opendocument.presentation-template"),
    b"ots" => t!("application/vnd.oasis.opendocument.spreadsheet-template"),
    b"ott" => t!("application/vnd.oasis.opendocument.text-template"),
    b"ova" => t!("application/x-virtualbox-ova"),
    b"ovf" => t!("application/x-virtualbox-ovf"),
    b"owl" => t!("application/rdf+xml"),
    b"oxps" => t!("application/oxps"),
    b"oxt" => t!("application/vnd.openofficeorg.extension"),
    b"p" => t!("text/x-pascal"),
    b"p10" => t!("application/pkcs10"),
    b"p12" => t!("application/x-pkcs12"),
    b"p7b" => t!("application/x-pkcs7-certificates"),
    b"p7c" => t!("application/pkcs7-mime"),
    b"p7m" => t!("application/pkcs7-mime"),
    b"p7r" => t!("application/x-pkcs7-certreqresp"),
    b"p7s" => t!("application/pkcs7-signature"),
    b"p8" => t!("application/pkcs8"),
    b"pac" => t!("application/x-ns-proxy-autoconfig"),
    b"pages" => t!("application/x-iwork-pages-sffpages"),
    b"pas" => t!("text/x-pascal"),
    b"paw" => t!("application/vnd.pawaafile"),
    b"pbd" => t!("application/vnd.powerbuilder6"),
    b"pbm" => t!("image/x-portable-bitmap"),
    b"pcap" => t!("application/vnd.tcpdump.pcap"),
    b"pcf" => t!("application/x-font-pcf"),
    b"pcl" => t!("application/vnd.hp-pcl"),
    b"pclxl" => t!("application/vnd.hp-pclxl"),
    b"pct" => t!("image/x-pict"),
    b"pcurl" => t!("application/vnd.curl.pcurl"),
    b"pcx" => t!("image/x-pcx"),
    b"pdb" => t!("application/x-pilot"),
    b"pde" => t!("text/x-processing"),
    b"pdf" => t!("application/pdf"),
    b"pem" => t!("application/x-x509-ca-cert"),
    b"pfa" => t!("application/x-font-type1"),
    b"pfb" => t!("application/x-font-type1"),
    b"pfm" => t!("application/x-font-type1"),
    b"pfr" => t!("application/font-tdpfr"),
    b"pfx" => t!("application/x-pkcs12"),
    b"pgm" => t!("image/x-portable-graymap"),
    b"pgn" => t!("application/x-chess-pgn"),
    b"pgp" => t!("application/pgp-encrypted"),
    b"php" => t!("application/x-httpd-php"),
    b"pic" => t!("image/x-pict"),
    b"pkg" => t!("application/octet-stream"),
    b"pki" => t!("application/pkixcmp"),
    b"pkipath" => t!("application/pkix-pkipath"),
    b"pkpass" => t!("application/vnd.apple.pkpass"),
    b"pl" => t!("application/x-perl"),
    b"plb" => t!("application/vnd.3gpp.pic-bw-large"),
    b"plc" => t!("application/vnd.mobius.plc"),
    b"plf" => t!("application/vnd.pocketlearn"),
    b"pls" => t!("application/pls+xml"),
    b"pm" => t!("application/x-perl"),
    b"pml" => t!("application/vnd.ctc-posml"),
    b"png" => t!("image/png"),
    b"pnm" => t!("image/x-portable-anymap"),
    b"portpkg" => t!("application/vnd.macports.portpkg"),
    b"pot" => t!("application/vnd.ms-powerpoint"),
    b"potm" => t!("application/vnd.ms-powerpoint.template.macroenabled.12"),
    b"potx" => t!("application/vnd.openxmlformats-officedocument.presentationml.template"),
    b"ppam" => t!("application/vnd.ms-powerpoint.addin.macroenabled.12"),
    b"ppd" => t!("application/vnd.cups-ppd"),
    b"ppm" => t!("image/x-portable-pixmap"),
    b"pps" => t!("application/vnd.ms-powerpoint"),
    b"ppsm" => t!("application/vnd.ms-powerpoint.slideshow.macroenabled.12"),
    b"ppsx" => t!("application/vnd.openxmlformats-officedocument.presentationml.slideshow"),
    b"ppt" => t!("application/vnd.ms-powerpoint"),
    b"pptm" => t!("application/vnd.ms-powerpoint.presentation.macroenabled.12"),
    b"pptx" => t!("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    b"pqa" => t!("application/vnd.palm"),
    b"prc" => t!("model/prc"),
    b"pre" => t!("application/vnd.lotus-freelance"),
    b"prf" => t!("application/pics-rules"),
    b"provx" => t!("application/provenance+xml"),
    b"ps" => t!("application/postscript"),
    b"psb" => t!("application/vnd.3gpp.pic-bw-small"),
    b"psd" => t!("image/vnd.adobe.photoshop"),
    b"psf" => t!("application/x-font-linux-psf"),
    b"pskcxml" => t!("application/pskc+xml"),
    b"pti" => t!("image/prs.pti"),
    b"ptid" => t!("application/vnd.pvi.ptid1"),
    b"pub" => t!("application/x-mspublisher"),
    b"pvb" => t!("application/vnd.3gpp.pic-bw-var"),
    b"pwn" => t!("application/vnd.3m.post-it-notes"),
    b"pya" => t!("audio/vnd.ms-playready.media.pya"),
    b"pyv" => t!("video/vnd.ms-playready.media.pyv"),
    b"qam" => t!("application/vnd.epson.quickanime"),
    b"qbo" => t!("application/vnd.intu.qbo"),
    b"qfx" => t!("application/vnd.intu.qfx"),
    b"qps" => t!("application/vnd.publishare-delta-tree"),
    b"qt" => t!("video/quicktime"),
    b"qwd" => t!("application/vnd.quark.quarkxpress"),
    b"qwt" => t!("application/vnd.quark.quarkxpress"),
    b"qxb" => t!("application/vnd.quark.quarkxpress"),
    b"qxd" => t!("application/vnd.quark.quarkxpress"),
    b"qxl" => t!("application/vnd.quark.quarkxpress"),
    b"qxt" => t!("application/vnd.quark.quarkxpress"),
    b"ra" => t!("audio/x-realaudio"),
    b"ram" => t!("audio/x-pn-realaudio"),
    b"raml" => t!("application/raml+yaml"),
    b"rapd" => t!("application/route-apd+xml"),
    b"rar" => t!("application/x-rar-compressed"),
    b"ras" => t!("image/x-cmu-raster"),
    b"rcprofile" => t!("application/vnd.ipunplugged.rcprofile"),
    b"rdf" => t!("application/rdf+xml"),
    b"rdz" => t!("application/vnd.data-vision.rdz"),
    b"relo" => t!("application/p2p-overlay+xml"),
    b"rep" => t!("application/vnd.businessobjects"),
    b"res" => t!("application/x-dtbresource+xml"),
    b"rgb" => t!("image/x-rgb"),
    b"rif" => t!("application/reginfo+xml"),
    b"rip" => t!("audio/vnd.rip"),
    b"ris" => t!("application/x-research-info-systems"),
    b"rl" => t!("application/resource-lists+xml"),
    b"rlc" => t!("image/vnd.fujixerox.edmics-rlc"),
    b"rld" => t!("application/resource-lists-diff+xml"),
    b"rm" => t!("application/vnd.rn-realmedia"),
    b"rmi" => t!("audio/midi"),
    b"rmp" => t!("audio/x-pn-realaudio-plugin"),
    b"rms" => t!("application/vnd.jcp.javame.midlet-rms"),
    b"rmvb" => t!("application/vnd.rn-realmedia-vbr"),
    b"rnc" => t!("application/relax-ng-compact-syntax"),
    b"rng" => t!("application/xml"),
    b"roa" => t!("application/rpki-roa"),
    b"roff" => t!("text/troff"),
    b"rp9" => t!("application/vnd.cloanto.rp9"),
    b"rpm" => t!("application/x-redhat-package-manager"),
    b"rpss" => t!("application/vnd.nokia.radio-presets"),
    b"rpst" => t!("application/vnd.nokia.radio-preset"),
    b"rq" => t!("application/sparql-query"),
    b"rs" => t!("application/rls-services+xml"),
    b"rsat" => t!("application/atsc-rsat+xml"),
    b"rsd" => t!("application/rsd+xml"),
    b"rsheet" => t!("application/urc-ressheet+xml"),
    b"rss" => t!("application/rss+xml"),
    b"rtf" => t!("text/rtf"),
    b"rtx" => t!("text/richtext"),
    b"run" => t!("application/x-makeself"),
    b"rusd" => t!("application/route-usd+xml"),
    b"s" => t!("text/x-asm"),
    b"s3m" => t!("audio/s3m"),
    b"saf" => t!("application/vnd.yamaha.smaf-audio"),
    b"sass" => t!("text/x-sass"),
    b"sbml" => t!("application/sbml+xml"),
    b"sc" => t!("application/vnd.ibm.secure-container"),
    b"scd" => t!("application/x-msschedule"),
    b"scm" => t!("application/vnd.lotus-screencam"),
    b"scq" => t!("application/scvp-cv-request"),
    b"scs" => t!("application/scvp-cv-response"),
    b"scss" => t!("text/x-scss"),
    b"scurl" => t!("text/vnd.curl.scurl"),
    b"sda" => t!("application/vnd.stardivision.draw"),
    b"sdc" => t!("application/vnd.stardivision.calc"),
    b"sdd" => t!("application/vnd.stardivision.impress"),
    b"sdkd" => t!("application/vnd.solent.sdkm+xml"),
    b"sdkm" => t!("application/vnd.solent.sdkm+xml"),
    b"sdp" => t!("application/sdp"),
    b"sdw" => t!("application/vnd.stardivision.writer"),
    b"sea" => t!("application/x-sea"),
    b"see" => t!("application/vnd.seemail"),
    b"seed" => t!("application/vnd.fdsn.seed"),
    b"sema" => t!("application/vnd.sema"),
    b"semd" => t!("application/vnd.semd"),
    b"semf" => t!("application/vnd.semf"),
    b"senmlx" => t!("application/senml+xml"),
    b"sensmlx" => t!("application/sensml+xml"),
    b"ser" => t!("application/java-serialized-object"),
    b"setpay" => t!("application/set-payment-initiation"),
    b"setreg" => t!("application/set-registration-initiation"),
    b"sfd-h" => t!("application/vnd.hydrostatix.sof-data"),
    b"sfs" => t!("application/vnd.spotfire.sfs"),
    b"sfv" => t!("text/x-sfv"),
    b"sgi" => t!("image/sgi"),
    b"sgl" => t!("application/vnd.stardivision.writer-global"),
    b"sgm" => t!("text/sgml"),
    b"sgml" => t!("text/sgml"),
    b"sh" => t!("application/x-sh"),
    b"shar" => t!("application/x-shar"),
    b"shex" => t!("text/shex"),
    b"shf" => t!("application/shf+xml"),
    b"shtml" => t!("text/html"),
    b"sid" => t!("image/x-mrsid-image"),
    b"sieve" => t!("application/sieve"),
    b"sig" => t!("application/pgp-signature"),
    b"sil" => t!("audio/silk"),
    b"silo" => t!("model/mesh"),
    b"sis" => t!("application/vnd.symbian.install"),
    b"sisx" => t!("application/vnd.symbian.install"),
    b"sit" => t!("application/x-stuffit"),
    b"sitx" => t!("application/x-stuffitx"),
    b"siv" => t!("application/sieve"),
    b"skd" => t!("application/vnd.koan"),
    b"skm" => t!("application/vnd.koan"),
    b"skp" => t!("application/vnd.koan"),
    b"skt" => t!("application/vnd.koan"),
    b"sldm" => t!("application/vnd.ms-powerpoint.slide.macroenabled.12"),
    b"sldx" => t!("application/vnd.openxmlformats-officedocument.presentationml.slide"),
    b"slim" => t!("text/slim"),
    b"slm" => t!("text/slim"),
    b"sls" => t!("application/route-s-tsid+xml"),
    b"slt" => t!("application/vnd.epson.salt"),
    b"sm" => t!("application/vnd.stepmania.stepchart"),
    b"smf" => t!("application/vnd.stardivision.math"),
    b"smi" => t!("application/smil+xml"),
    b"smil" => t!("application/smil+xml"),
    b"smv" => t!("video/x-smv"),
    b"smzip" => t!("application/vnd.stepmania.package"),
    b"snd" => t!("audio/basic"),
    b"snf" => t!("application/x-font-snf"),
    b"so" => t!("application/octet-stream"),
    b"spc" => t!("application/x-pkcs7-certificates"),
    b"spdx" => t!("text/spdx"),
    b"spf" => t!("application/vnd.yamaha.smaf-phrase"),
    b"spl" => t!("application/x-futuresplash"),
    b"spot" => t!("text/vnd.in3d.spot"),
    b"spp" => t!("application/scvp-vp-response"),
    b"spq" => t!("application/scvp-vp-request"),
    b"spx" => t!("audio/ogg"),
    b"sql" => t!("application/x-sql"),
    b"src" => t!("application/x-wais-source"),
    b"srt" => t!("application/x-subrip"),
    b"sru" => t!("application/sru+xml"),
    b"srx" => t!("application/sparql-results+xml"),
    b"ssdl" => t!("application/ssdl+xml"),
    b"sse" => t!("application/vnd.kodak-descriptor"),
    b"ssf" => t!("application/vnd.epson.ssf"),
    b"ssml" => t!("application/ssml+xml"),
    b"st" => t!("application/vnd.sailingtracker.track"),
    b"stc" => t!("application/vnd.sun.xml.calc.template"),
    b"std" => t!("application/vnd.sun.xml.draw.template"),
    b"stf" => t!("application/vnd.wt.stf"),
    b"sti" => t!("application/vnd.sun.xml.impress.template"),
    b"stk" => t!("application/hyperstudio"),
    b"stl" => t!("model/stl"),
    b"stpx" => t!("model/step+xml"),
    b"stpxz" => t!("model/step-xml+zip"),
    b"stpz" => t!("model/step+zip"),
    b"str" => t!("application/vnd.pg.format"),
    b"stw" => t!("application/vnd.sun.xml.writer.template"),
    b"styl" => t!("text/stylus"),
    b"stylus" => t!("text/stylus"),
    b"sub" => t!("text/vnd.dvb.subtitle"),
    b"sus" => t!("application/vnd.sus-calendar"),
    b"susp" => t!("application/vnd.sus-calendar"),
    b"sv4cpio" => t!("application/x-sv4cpio"),
    b"sv4crc" => t!("application/x-sv4crc"),
    b"svc" => t!("application/vnd.dvb.service"),
    b"svd" => t!("application/vnd.svd"),
    b"svg" => t!("image/svg+xml"),
    b"svgz" => t!("image/svg+xml"),
    b"swa" => t!("application/x-director"),
    b"swf" => t!("application/x-shockwave-flash"),
    b"swi" => t!("application/vnd.aristanetworks.swi"),
    b"swidtag" => t!("application/swid+xml"),
    b"sxc" => t!("application/vnd.sun.xml.calc"),
    b"sxd" => t!("application/vnd.sun.xml.draw"),
    b"sxg" => t!("application/vnd.sun.xml.writer.global"),
    b"sxi" => t!("application/vnd.sun.xml.impress"),
    b"sxm" => t!("application/vnd.sun.xml.math"),
    b"sxw" => t!("application/vnd.sun.xml.writer"),
    b"t" => t!("text/troff"),
    b"t3" => t!("application/x-t3vm-image"),
    b"t38" => t!("image/t38"),
    b"taglet" => t!("application/vnd.mynfc"),
    b"tao" => t!("application/vnd.tao.intent-module-archive"),
    b"tap" => t!("image/vnd.tencent.tap"),
    b"tar" => t!("application/x-tar"),
    b"tcap" => t!("application/vnd.3gpp2.tcap"),
    b"tcl" => t!("application/x-tcl"),
    b"td" => t!("application/urc-targetdesc+xml"),
    b"teacher" => t!("application/vnd.smart.teacher"),
    b"tei" => t!("application/tei+xml"),
    b"teicorpus" => t!("application/tei+xml"),
    b"tex" => t!("application/x-tex"),
    b"texi" => t!("application/x-texinfo"),
    b"texinfo" => t!("application/x-texinfo"),
    b"text" => t!("text/plain"),
    b"tfi" => t!("application/thraud+xml"),
    b"tfm" => t!("application/x-tex-tfm"),
    b"tfx" => t!("image/tiff-fx"),
    b"tga" => t!("image/x-tga"),
    b"thmx" => t!("application/vnd.ms-officetheme"),
    b"tif" => t!("image/tiff"),
    b"tiff" => t!("image/tiff"),
    b"tk" => t!("application/x-tcl"),
    b"tmo" => t!("application/vnd.tmobile-livetv"),
    b"toml" => t!("application/toml"),
    b"yaml" => t!("text/yaml"),
    b"yml" => t!("text/yaml"),
    b"torrent" => t!("application/x-bittorrent"),
    b"tpl" => t!("application/vnd.groove-tool-template"),
    b"tpt" => t!("application/vnd.trid.tpt"),
    b"tr" => t!("text/troff"),
    b"tra" => t!("application/vnd.trueapp"),
    b"trig" => t!("application/trig"),
    b"trm" => t!("application/x-msterminal"),
    b"ts" => t!("application/javascript"),
    b"tsx" => t!("application/javascript"),
    b"tsd" => t!("application/timestamped-data"),
    b"tsv" => t!("text/tab-separated-values"),
    b"tsx" => t!("application/javascript"),
    b"ttc" => t!("font/collection"),
    b"ttf" => t!("font/ttf"),
    b"ttl" => t!("text/turtle"),
    b"ttml" => t!("application/ttml+xml"),
    b"twd" => t!("application/vnd.simtech-mindmapper"),
    b"twds" => t!("application/vnd.simtech-mindmapper"),
    b"txd" => t!("application/vnd.genomatix.tuxedo"),
    b"txf" => t!("application/vnd.mobius.txf"),
    b"txt" => t!("text/plain"),
    b"u32" => t!("application/x-authorware-bin"),
    b"u3d" => t!("model/u3d"),
    b"u8dsn" => t!("message/global-delivery-status"),
    b"u8hdr" => t!("message/global-headers"),
    b"u8mdn" => t!("message/global-disposition-notification"),
    b"u8msg" => t!("message/global"),
    b"ubj" => t!("application/ubjson"),
    b"udeb" => t!("application/x-debian-package"),
    b"ufd" => t!("application/vnd.ufdl"),
    b"ufdl" => t!("application/vnd.ufdl"),
    b"ulx" => t!("application/x-glulx"),
    b"umj" => t!("application/vnd.umajin"),
    b"unityweb" => t!("application/vnd.unity"),
    b"uoml" => t!("application/vnd.uoml+xml"),
    b"uri" => t!("text/uri-list"),
    b"uris" => t!("text/uri-list"),
    b"urls" => t!("text/uri-list"),
    b"usdz" => t!("model/vnd.usdz+zip"),
    b"ustar" => t!("application/x-ustar"),
    b"utz" => t!("application/vnd.uiq.theme"),
    b"uu" => t!("text/x-uuencode"),
    b"uva" => t!("audio/vnd.dece.audio"),
    b"uvd" => t!("application/vnd.dece.data"),
    b"uvf" => t!("application/vnd.dece.data"),
    b"uvg" => t!("image/vnd.dece.graphic"),
    b"uvh" => t!("video/vnd.dece.hd"),
    b"uvi" => t!("image/vnd.dece.graphic"),
    b"uvm" => t!("video/vnd.dece.mobile"),
    b"uvp" => t!("video/vnd.dece.pd"),
    b"uvs" => t!("video/vnd.dece.sd"),
    b"uvt" => t!("application/vnd.dece.ttml+xml"),
    b"uvu" => t!("video/vnd.uvvu.mp4"),
    b"uvv" => t!("video/vnd.dece.video"),
    b"uvva" => t!("audio/vnd.dece.audio"),
    b"uvvd" => t!("application/vnd.dece.data"),
    b"uvvf" => t!("application/vnd.dece.data"),
    b"uvvg" => t!("image/vnd.dece.graphic"),
    b"uvvh" => t!("video/vnd.dece.hd"),
    b"uvvi" => t!("image/vnd.dece.graphic"),
    b"uvvm" => t!("video/vnd.dece.mobile"),
    b"uvvp" => t!("video/vnd.dece.pd"),
    b"uvvs" => t!("video/vnd.dece.sd"),
    b"uvvt" => t!("application/vnd.dece.ttml+xml"),
    b"uvvu" => t!("video/vnd.uvvu.mp4"),
    b"uvvv" => t!("video/vnd.dece.video"),
    b"uvvx" => t!("application/vnd.dece.unspecified"),
    b"uvvz" => t!("application/vnd.dece.zip"),
    b"uvx" => t!("application/vnd.dece.unspecified"),
    b"uvz" => t!("application/vnd.dece.zip"),
    b"vbox-e" => t!("application/x-virtualbox-vbox-extpack"),
    b"vbox" => t!("application/x-virtualbox-vbox"),
    b"vcard" => t!("text/vcard"),
    b"vcd" => t!("application/x-cdlink"),
    b"vcf" => t!("text/x-vcard"),
    b"vcg" => t!("application/vnd.groove-vcard"),
    b"vcs" => t!("text/x-vcalendar"),
    b"vcx" => t!("application/vnd.vcx"),
    b"vdi" => t!("application/x-virtualbox-vdi"),
    b"vds" => t!("model/vnd.sap.vds"),
    b"vhd" => t!("application/x-virtualbox-vhd"),
    b"vis" => t!("application/vnd.visionary"),
    b"viv" => t!("video/vnd.vivo"),
    b"vmdk" => t!("application/x-virtualbox-vmdk"),
    b"vob" => t!("video/x-ms-vob"),
    b"vor" => t!("application/vnd.stardivision.writer"),
    b"vox" => t!("application/x-authorware-bin"),
    b"vrml" => t!("model/vrml"),
    b"vsd" => t!("application/vnd.visio"),
    b"vsf" => t!("application/vnd.vsf"),
    b"vss" => t!("application/vnd.visio"),
    b"vst" => t!("application/vnd.visio"),
    b"vsw" => t!("application/vnd.visio"),
    b"vtf" => t!("image/vnd.valve.source.texture"),
    b"vtt" => t!("text/vtt"),
    b"vtu" => t!("model/vnd.vtu"),
    b"vxml" => t!("application/voicexml+xml"),
    b"w3d" => t!("application/x-director"),
    b"wad" => t!("application/x-doom"),
    b"wadl" => t!("application/vnd.sun.wadl+xml"),
    b"war" => t!("application/java-archive"),
    b"wasm" => t!("application/webassembly"),
    b"wav" => t!("audio/x-wav"),
    b"wax" => t!("audio/x-ms-wax"),
    b"wbmp" => t!("image/vnd.wap.wbmp"),
    b"wbs" => t!("application/vnd.criticaltools.wbs+xml"),
    b"wbxml" => t!("application/vnd.wap.wbxml"),
    b"wcm" => t!("application/vnd.ms-works"),
    b"wdb" => t!("application/vnd.ms-works"),
    b"wdp" => t!("image/vnd.ms-photo"),
    b"weba" => t!("audio/webm"),
    b"webapp" => t!("application/x-web-app-manifest+json"),
    b"webm" => t!("video/webm"),
    b"webmanifest" => t!("application/manifest+json"),
    b"webp" => t!("image/webp"),
    b"wg" => t!("application/vnd.pmi.widget"),
    b"wgt" => t!("application/widget"),
    b"wif" => t!("application/watcherinfo+xml"),
    b"wks" => t!("application/vnd.ms-works"),
    b"wm" => t!("video/x-ms-wm"),
    b"wma" => t!("audio/x-ms-wma"),
    b"wmd" => t!("application/x-ms-wmd"),
    b"wmf" => t!("image/wmf"),
    b"wml" => t!("text/vnd.wap.wml"),
    b"wmlc" => t!("application/vnd.wap.wmlc"),
    b"wmls" => t!("text/vnd.wap.wmlscript"),
    b"wmlsc" => t!("application/vnd.wap.wmlscriptc"),
    b"wmv" => t!("video/x-ms-wmv"),
    b"wmx" => t!("video/x-ms-wmx"),
    b"wmz" => t!("application/x-msmetafile"),
    b"woff" => t!("font/woff"),
    b"woff2" => t!("font/woff2"),
    b"wpd" => t!("application/vnd.wordperfect"),
    b"wpl" => t!("application/vnd.ms-wpl"),
    b"wps" => t!("application/vnd.ms-works"),
    b"wqd" => t!("application/vnd.wqd"),
    b"wri" => t!("application/x-mswrite"),
    b"wrl" => t!("model/vrml"),
    b"wsc" => t!("message/vnd.wfa.wsc"),
    b"wsdl" => t!("application/wsdl+xml"),
    b"wspolicy" => t!("application/wspolicy+xml"),
    b"wtb" => t!("application/vnd.webturbo"),
    b"wvx" => t!("video/x-ms-wvx"),
    b"x_b" => t!("model/vnd.parasolid.transmit.binary"),
    b"x_t" => t!("model/vnd.parasolid.transmit.text"),
    b"x32" => t!("application/x-authorware-bin"),
    b"x3d" => t!("model/x3d+xml"),
    b"x3db" => t!("model/x3d+fastinfoset"),
    b"x3dbz" => t!("model/x3d+binary"),
    b"x3dv" => t!("model/x3d+vrml"),
    b"x3dvz" => t!("model/x3d+vrml"),
    b"x3dz" => t!("model/x3d+xml"),
    b"xaml" => t!("application/xaml+xml"),
    b"xap" => t!("application/x-silverlight-app"),
    b"xar" => t!("application/vnd.xara"),
    b"xav" => t!("application/xcap-att+xml"),
    b"xbap" => t!("application/x-ms-xbap"),
    b"xbd" => t!("application/vnd.fujixerox.docuworks.binder"),
    b"xbm" => t!("image/x-xbitmap"),
    b"xca" => t!("application/xcap-caps+xml"),
    b"xcs" => t!("application/calendar+xml"),
    b"xdf" => t!("application/xcap-diff+xml"),
    b"xdm" => t!("application/vnd.syncml.dm+xml"),
    b"xdp" => t!("application/vnd.adobe.xdp+xml"),
    b"xdssc" => t!("application/dssc+xml"),
    b"xdw" => t!("application/vnd.fujixerox.docuworks"),
    b"xel" => t!("application/xcap-el+xml"),
    b"xenc" => t!("application/xenc+xml"),
    b"xer" => t!("application/patch-ops-error+xml"),
    b"xfdf" => t!("application/vnd.adobe.xfdf"),
    b"xfdl" => t!("application/vnd.xfdl"),
    b"xht" => t!("application/xhtml+xml"),
    b"xhtml" => t!("application/xhtml+xml"),
    b"xhvml" => t!("application/xv+xml"),
    b"xif" => t!("image/vnd.xiff"),
    b"xla" => t!("application/vnd.ms-excel"),
    b"xlam" => t!("application/vnd.ms-excel.addin.macroenabled.12"),
    b"xlc" => t!("application/vnd.ms-excel"),
    b"xlf" => t!("application/xliff+xml"),
    b"xlm" => t!("application/vnd.ms-excel"),
    b"xls" => t!("application/vnd.ms-excel"),
    b"xlsb" => t!("application/vnd.ms-excel.sheet.binary.macroenabled.12"),
    b"xlsm" => t!("application/vnd.ms-excel.sheet.macroenabled.12"),
    b"xlsx" => t!("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    b"xlt" => t!("application/vnd.ms-excel"),
    b"xltm" => t!("application/vnd.ms-excel.template.macroenabled.12"),
    b"xltx" => t!("application/vnd.openxmlformats-officedocument.spreadsheetml.template"),
    b"xlw" => t!("application/vnd.ms-excel"),
    b"xm" => t!("audio/xm"),
    b"xml" => t!("application/xml"),
    b"xns" => t!("application/xcap-ns+xml"),
    b"xo" => t!("application/vnd.olpc-sugar"),
    b"xop" => t!("application/xop+xml"),
    b"xpi" => t!("application/x-xpinstall"),
    b"xpl" => t!("application/xproc+xml"),
    b"xpm" => t!("image/x-xpixmap"),
    b"xpr" => t!("application/vnd.is-xpr"),
    b"xps" => t!("application/vnd.ms-xpsdocument"),
    b"xpw" => t!("application/vnd.intercon.formnet"),
    b"xpx" => t!("application/vnd.intercon.formnet"),
    b"xsd" => t!("application/xml"),
    b"xsl" => t!("application/xslt+xml"),
    b"xslt" => t!("application/xslt+xml"),
    b"xsm" => t!("application/vnd.syncml+xml"),
    b"xspf" => t!("application/xspf+xml"),
    b"xul" => t!("application/vnd.mozilla.xul+xml"),
    b"xvm" => t!("application/xv+xml"),
    b"xvml" => t!("application/xv+xml"),
    b"xwd" => t!("image/x-xwindowdump"),
    b"xyz" => t!("chemical/x-xyz"),
    b"xz" => t!("application/x-xz"),
    b"yaml" => t!("text/yaml"),
    b"yang" => t!("application/yang"),
    b"yin" => t!("application/yin+xml"),
    b"yml" => t!("text/yaml"),
    b"ymp" => t!("text/x-suse-ymp"),
    b"z1" => t!("application/x-zmachine"),
    b"z2" => t!("application/x-zmachine"),
    b"z3" => t!("application/x-zmachine"),
    b"z4" => t!("application/x-zmachine"),
    b"z5" => t!("application/x-zmachine"),
    b"z6" => t!("application/x-zmachine"),
    b"z7" => t!("application/x-zmachine"),
    b"z8" => t!("application/x-zmachine"),
    b"zaz" => t!("application/vnd.zzazz.deck+xml"),
    b"zip" => t!("application/zip"),
    b"zir" => t!("application/vnd.zul"),
    b"zirz" => t!("application/vnd.zul"),
    b"zmm" => t!("application/vnd.handheld-entertainment+xml"),
};

const IMAGES_HEADERS: &[(&[u8], Table)] = &[
    (&[0x42, 0x4d], t!("image/bmp")),
    (&[0xff, 0xd8, 0xff], t!("image/jpeg")),
    (&[0x49, 0x49, 0x2a, 0x00], t!("image/tiff")),
    (&[0x4d, 0x4d, 0x00, 0x2a], t!("image/tiff")),
    (&[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], t!("image/gif")),
    (&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], t!("image/png")),
];

pub fn sniff(bytes: &[u8]) -> Option<MimeType> {
    if bytes.len() < 2 {
        return None;
    }

    // PERF(port): was `inline for` over heterogeneous-length tuples — profile in Phase B
    for (header, table) in IMAGES_HEADERS {
        if bytes.len() >= header.len() {
            if &bytes[0..header.len()] == *header {
                return Some(Compact::from(*table).to_mime_type());
            }
        }
    }

    None
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_types/MimeType.zig (1635 lines)
//   confidence: medium
//   todos:      7
//   notes:      Table variant idents need codegen scheme (`t!` placeholder); `value` field ownership is mixed static/borrowed/owned — Phase B should switch to Cow<'static,[u8]>; phf_map has 3 dup keys (tsx/yaml/yml) to dedupe.
// ──────────────────────────────────────────────────────────────────────────
