//! The loader numbering shared with C++ (`BunLoaderType` in
//! `src/jsc/bindings/headers-handwritten.h`) and the JS builtins
//! (`$LoaderLabelToId` in `src/codegen/replacements.ts`).

pub mod api {
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    #[allow(non_camel_case_types)]
    pub enum Loader {
        #[default]
        _none = 254,
        jsx = 1,
        js = 2,
        ts = 3,
        tsx = 4,
        css = 5,
        file = 6,
        json = 7,
        jsonc = 8,
        toml = 9,
        wasm = 10,
        napi = 11,
        base64 = 12,
        dataurl = 13,
        text = 14,
        bunsh = 15,
        sqlite = 16,
        sqlite_embedded = 17,
        html = 18,
        yaml = 19,
        json5 = 20,
        md = 21,
        xml = 22,
    }

    impl Loader {
        /// Unknown discriminants fall back to `_none`.
        #[inline]
        pub const fn from_raw(n: u8) -> Loader {
            match n {
                1 => Loader::jsx,
                2 => Loader::js,
                3 => Loader::ts,
                4 => Loader::tsx,
                5 => Loader::css,
                6 => Loader::file,
                7 => Loader::json,
                8 => Loader::jsonc,
                9 => Loader::toml,
                10 => Loader::wasm,
                11 => Loader::napi,
                12 => Loader::base64,
                13 => Loader::dataurl,
                14 => Loader::text,
                15 => Loader::bunsh,
                16 => Loader::sqlite,
                17 => Loader::sqlite_embedded,
                18 => Loader::html,
                19 => Loader::yaml,
                20 => Loader::json5,
                21 => Loader::md,
                22 => Loader::xml,
                _ => Loader::_none,
            }
        }
    }

    /// Parallel-array map from file extension to [`Loader`].
    #[derive(Clone, Debug, Default)]
    pub struct LoaderMap {
        pub extensions: Vec<Box<[u8]>>,
        pub loaders: Vec<Loader>,
    }
}
