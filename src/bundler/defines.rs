use core::ptr::NonNull;

use bun_collections::{ArrayHashMap, StringHashMap};
use bun_js_parser as js_ast;
use bun_js_parser::js_lexer;
use bun_js_parser::Ref;
use bun_logger as logger;
use bun_fs as fs;
use bun_str::strings;

use crate::defines_table as table;
use crate::defines_table::{
    global_no_side_effect_function_calls_safe_for_to_string, global_no_side_effect_property_accesses,
};

// TODO(port): Globals — these statics depend on the ported layout of `js_ast::Expr::Data`
// (whether `e_number` / `e_undefined` variants store pointers or inline values). Phase B
// should align with `bun_js_parser::Expr::Data`.
pub struct Globals;
impl Globals {
    pub const UNDEFINED: js_ast::E::Undefined = js_ast::E::Undefined {};
    pub const UNDEFINED_PTR: &'static js_ast::E::Undefined = &Globals::UNDEFINED;

    pub const NAN: js_ast::E::Number = js_ast::E::Number { value: f64::NAN };
    pub const NAN_PTR: &'static js_ast::E::Number = &Globals::NAN;

    pub const INFINITY: js_ast::E::Number = js_ast::E::Number { value: f64::INFINITY };
    pub const INFINITY_PTR: &'static js_ast::E::Number = &Globals::INFINITY;

    // TODO(port): Expr::Data variant construction — adjust once js_ast::Expr::Data is ported
    pub const UNDEFINED_DATA: js_ast::Expr::Data = js_ast::Expr::Data::EUndefined(Globals::UNDEFINED_PTR);
    pub const NAN_DATA: js_ast::Expr::Data = js_ast::Expr::Data::ENumber(Globals::NAN_PTR);
    pub const INFINITY_DATA: js_ast::Expr::Data = js_ast::Expr::Data::ENumber(Globals::INFINITY_PTR);
}

// TODO(port): fs::Path::init_with_namespace may not be const fn; if not, use once_cell in Phase B
const DEFINES_PATH: fs::Path = fs::Path::init_with_namespace(b"defines.json", b"internal");

pub type RawDefines = ArrayHashMap<Box<[u8]>, Box<[u8]>>;
pub type UserDefines = StringHashMap<DefineData>;
pub type UserDefinesArray = ArrayHashMap<Box<[u8]>, DefineData>;

// ══════════════════════════════════════════════════════════════════════════
// CYCLEBREAK(b0): vtable instances for `bun_dotenv::DefineStoreVTable`
// (cold-path §Dispatch). dotenv (T2) calls through `DefineStoreRef`; bundler
// (T5) owns the concrete `E::String` + `DefineData` construction. Mirrors
// src/dotenv/env_loader.zig:399 `copyForDefine` — `to_string` is a
// `StringHashMap<DefineData>` (= UserDefines), `to_json` is a
// `StringHashMap<Box<[u8]>>` (= RawDefines / framework defaults).
// ══════════════════════════════════════════════════════════════════════════

/// Backs `to_string: *StringStore` in `Loader.copyForDefine`.
/// Owner type: `*mut UserDefines` (`StringHashMap<DefineData>`).
pub static ENV_DEFINE_STRING_STORE_VTABLE: bun_dotenv::DefineStoreVTable = bun_dotenv::DefineStoreVTable {
    contains: |owner, key| {
        // SAFETY: vtable contract — owner is `*mut UserDefines`.
        unsafe { &*(owner as *const UserDefines) }.contains_key(key)
    },
    put_string_define: |owner, key, value| {
        // SAFETY: vtable contract — owner is `*mut UserDefines`.
        let store = unsafe { &mut *(owner as *mut UserDefines) };
        // Mirrors Zig: allocate an `E.String` slab entry, point Expr::Data at it,
        // wrap in DefineData::init({can_be_removed_if_unused: true,
        // call_can_be_unwrapped_if_unused: .if_unused}). The E.String is leaked
        // for the bundle's lifetime (Zig used a bump-alloc'd slab).
        let e_string: &'static js_ast::E::String = Box::leak(Box::new(js_ast::E::String {
            data: value.to_vec().into_boxed_slice(),
            ..Default::default()
        }));
        let data = DefineData::init(Options {
            value: js_ast::Expr::Data::EString(e_string),
            can_be_removed_if_unused: true,
            call_can_be_unwrapped_if_unused: js_ast::E::CallUnwrap::IfUnused,
            ..Default::default()
        });
        store.get_or_put_value(key, data)?;
        Ok(())
    },
    put_raw: |owner, key, value| {
        // String-store fallback: treat raw as a string literal too (Zig never
        // routes `put_raw` to the StringStore — keep it total for safety).
        (ENV_DEFINE_STRING_STORE_VTABLE.put_string_define)(owner, key, value)
    },
};

/// Backs `to_json: *JSONStore` in `Loader.copyForDefine`.
/// Owner type: `*mut StringHashMap<Box<[u8]>>` (raw key→source mapping that
/// `DefineData::from_input` later parses).
pub static ENV_DEFINE_JSON_STORE_VTABLE: bun_dotenv::DefineStoreVTable = bun_dotenv::DefineStoreVTable {
    contains: |owner, key| {
        // SAFETY: vtable contract — owner is `*mut StringHashMap<Box<[u8]>>`.
        unsafe { &*(owner as *const StringHashMap<Box<[u8]>>) }.contains_key(key)
    },
    put_string_define: |owner, key, value| {
        // JSON store wants the raw bytes (later fed to DefineData::from_input).
        // SAFETY: vtable contract.
        let store = unsafe { &mut *(owner as *mut StringHashMap<Box<[u8]>>) };
        store.get_or_put_value(key, value.to_vec().into_boxed_slice())?;
        Ok(())
    },
    put_raw: |owner, key, value| {
        // SAFETY: vtable contract.
        let store = unsafe { &mut *(owner as *mut StringHashMap<Box<[u8]>>) };
        store.get_or_put_value(key, value.to_vec().into_boxed_slice())?;
        Ok(())
    },
};

/// Convenience: build a `DefineStoreRef` over a `UserDefines` map.
#[inline]
pub fn env_define_string_store_ref(store: &mut UserDefines) -> bun_dotenv::DefineStoreRef<'_> {
    bun_dotenv::DefineStoreRef::new(
        store as *mut UserDefines as *mut (),
        &ENV_DEFINE_STRING_STORE_VTABLE,
    )
}
/// Convenience: build a `DefineStoreRef` over a raw JSON-string map.
#[inline]
pub fn env_define_json_store_ref(
    store: &mut StringHashMap<Box<[u8]>>,
) -> bun_dotenv::DefineStoreRef<'_> {
    bun_dotenv::DefineStoreRef::new(
        store as *mut StringHashMap<Box<[u8]>> as *mut (),
        &ENV_DEFINE_JSON_STORE_VTABLE,
    )
}

#[derive(Clone)]
pub struct DefineData {
    pub value: js_ast::Expr::Data,

    // Not using a slice here shrinks the size from 48 bytes to 40 bytes.
    // TODO(port): lifetime — borrows into caller-owned key/value strings
    original_name_ptr: Option<NonNull<u8>>,
    original_name_len: u32,

    pub flags: Flags,
}

impl Default for DefineData {
    fn default() -> Self {
        Self {
            value: js_ast::Expr::Data::default(),
            original_name_ptr: None,
            original_name_len: 0,
            flags: Flags::default(),
        }
    }
}

/// Zig: `packed struct(u8)` — not all fields are bool (`_padding: u3`,
/// `call_can_be_unwrapped_if_unused: CallUnwrap` is 2 bits), so per PORTING.md
/// this is a `#[repr(transparent)]` newtype with manual shift accessors
/// matching field order (LSB-first).
#[repr(transparent)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct Flags(u8);

impl Flags {
    // bit layout (LSB-first, matching Zig packed struct field order):
    //   [0..3) _padding
    //   [3]    valueless
    //   [4]    can_be_removed_if_unused
    //   [5..7) call_can_be_unwrapped_if_unused (CallUnwrap, 2 bits)
    //   [7]    method_call_must_be_replaced_with_undefined
    const VALUELESS_SHIFT: u8 = 3;
    const CAN_BE_REMOVED_SHIFT: u8 = 4;
    const CALL_UNWRAP_SHIFT: u8 = 5;
    const CALL_UNWRAP_MASK: u8 = 0b11 << Self::CALL_UNWRAP_SHIFT;
    const METHOD_CALL_UNDEF_SHIFT: u8 = 7;

    #[inline]
    pub const fn valueless(self) -> bool {
        (self.0 >> Self::VALUELESS_SHIFT) & 1 != 0
    }
    #[inline]
    pub fn set_valueless(&mut self, v: bool) {
        self.0 = (self.0 & !(1 << Self::VALUELESS_SHIFT)) | ((v as u8) << Self::VALUELESS_SHIFT);
    }

    #[inline]
    pub const fn can_be_removed_if_unused(self) -> bool {
        (self.0 >> Self::CAN_BE_REMOVED_SHIFT) & 1 != 0
    }
    #[inline]
    pub fn set_can_be_removed_if_unused(&mut self, v: bool) {
        self.0 = (self.0 & !(1 << Self::CAN_BE_REMOVED_SHIFT)) | ((v as u8) << Self::CAN_BE_REMOVED_SHIFT);
    }

    #[inline]
    pub fn call_can_be_unwrapped_if_unused(self) -> js_ast::E::CallUnwrap {
        // SAFETY: CallUnwrap is #[repr(u8)] with values fitting in 2 bits
        unsafe {
            core::mem::transmute::<u8, js_ast::E::CallUnwrap>(
                (self.0 & Self::CALL_UNWRAP_MASK) >> Self::CALL_UNWRAP_SHIFT,
            )
        }
    }
    #[inline]
    pub fn set_call_can_be_unwrapped_if_unused(&mut self, v: js_ast::E::CallUnwrap) {
        self.0 = (self.0 & !Self::CALL_UNWRAP_MASK) | (((v as u8) & 0b11) << Self::CALL_UNWRAP_SHIFT);
    }

    #[inline]
    pub const fn method_call_must_be_replaced_with_undefined(self) -> bool {
        (self.0 >> Self::METHOD_CALL_UNDEF_SHIFT) & 1 != 0
    }
    #[inline]
    pub fn set_method_call_must_be_replaced_with_undefined(&mut self, v: bool) {
        self.0 =
            (self.0 & !(1 << Self::METHOD_CALL_UNDEF_SHIFT)) | ((v as u8) << Self::METHOD_CALL_UNDEF_SHIFT);
    }

    pub fn new(
        valueless: bool,
        can_be_removed_if_unused: bool,
        call_can_be_unwrapped_if_unused: js_ast::E::CallUnwrap,
        method_call_must_be_replaced_with_undefined: bool,
    ) -> Self {
        let mut f = Flags(0);
        f.set_valueless(valueless);
        f.set_can_be_removed_if_unused(can_be_removed_if_unused);
        f.set_call_can_be_unwrapped_if_unused(call_can_be_unwrapped_if_unused);
        f.set_method_call_must_be_replaced_with_undefined(method_call_must_be_replaced_with_undefined);
        f
    }
}

pub struct Options<'a> {
    pub original_name: Option<&'a [u8]>,
    pub value: js_ast::Expr::Data,
    pub valueless: bool,
    pub can_be_removed_if_unused: bool,
    pub call_can_be_unwrapped_if_unused: js_ast::E::CallUnwrap,
    pub method_call_must_be_replaced_with_undefined: bool,
}

impl<'a> Default for Options<'a> {
    fn default() -> Self {
        Self {
            original_name: None,
            value: js_ast::Expr::Data::default(),
            valueless: false,
            can_be_removed_if_unused: false,
            call_can_be_unwrapped_if_unused: js_ast::E::CallUnwrap::Never,
            method_call_must_be_replaced_with_undefined: false,
        }
    }
}

impl DefineData {
    pub fn init(options: Options<'_>) -> DefineData {
        DefineData {
            value: options.value,
            flags: Flags::new(
                options.valueless,
                options.can_be_removed_if_unused,
                options.call_can_be_unwrapped_if_unused,
                options.method_call_must_be_replaced_with_undefined,
            ),
            original_name_ptr: options.original_name.and_then(|name| NonNull::new(name.as_ptr() as *mut u8)),
            original_name_len: options
                .original_name
                .map(|name| name.len() as u32) // @truncate
                .unwrap_or(0),
        }
    }

    #[inline]
    pub fn original_name(&self) -> Option<&[u8]> {
        if self.original_name_len > 0 {
            // TODO(port): lifetime — this borrows caller-owned memory; not tracked by borrowck
            let ptr = self.original_name_ptr.unwrap();
            // SAFETY: original_name_ptr is non-null when original_name_len > 0, and points to
            // a slice of original_name_len bytes that the caller keeps alive.
            return Some(unsafe { core::slice::from_raw_parts(ptr.as_ptr(), self.original_name_len as usize) });
        }
        None
    }

    /// True if accessing this value is known to not have any side effects. For
    /// example, a bare reference to "Object.create" can be removed because it
    /// does not have any observable side effects.
    #[inline]
    pub fn can_be_removed_if_unused(&self) -> bool {
        self.flags.can_be_removed_if_unused()
    }

    /// True if a call to this value is known to not have any side effects. For
    /// example, a bare call to "Object()" can be removed because it does not
    /// have any observable side effects.
    #[inline]
    pub fn call_can_be_unwrapped_if_unused(&self) -> js_ast::E::CallUnwrap {
        self.flags.call_can_be_unwrapped_if_unused()
    }

    #[inline]
    pub fn method_call_must_be_replaced_with_undefined(&self) -> bool {
        self.flags.method_call_must_be_replaced_with_undefined()
    }

    #[inline]
    pub fn valueless(&self) -> bool {
        self.flags.valueless()
    }

    pub fn init_boolean(value: bool) -> DefineData {
        let mut flags = Flags::default();
        flags.set_can_be_removed_if_unused(true);
        DefineData {
            value: js_ast::Expr::Data::EBoolean(js_ast::E::Boolean { value }),
            flags,
            ..Default::default()
        }
    }

    pub fn init_static_string(str: &'static js_ast::E::String) -> DefineData {
        let mut flags = Flags::default();
        flags.set_can_be_removed_if_unused(true);
        DefineData {
            // Zig: @constCast(str) — Expr.Data.e_string stores *E.String
            // TODO(port): Expr::Data::EString pointer mutability — adjust once js_ast is ported
            value: js_ast::Expr::Data::EString(str as *const _ as *mut _),
            flags,
            ..Default::default()
        }
    }

    pub fn merge(a: DefineData, b: DefineData) -> DefineData {
        DefineData {
            value: b.value,
            flags: Flags::new(
                // TODO: investigate if this is correct. This is what it was before. But that looks strange.
                /* valueless: */
                a.method_call_must_be_replaced_with_undefined()
                    || b.method_call_must_be_replaced_with_undefined(),
                /* can_be_removed_if_unused: */ a.can_be_removed_if_unused(),
                /* call_can_be_unwrapped_if_unused: */ a.call_can_be_unwrapped_if_unused(),
                /* method_call_must_be_replaced_with_undefined: */
                a.method_call_must_be_replaced_with_undefined()
                    || b.method_call_must_be_replaced_with_undefined(),
            ),
            original_name_ptr: b.original_name_ptr,
            original_name_len: b.original_name_len,
        }
    }

    pub fn from_mergeable_input_entry(
        user_defines: &mut UserDefines,
        key: &[u8],
        value_str: &[u8],
        value_is_undefined: bool,
        method_call_must_be_replaced_with_undefined_: bool,
        log: &mut logger::Log,
    ) -> Result<(), bun_core::Error> {
        // PERF(port): was putAssumeCapacity — profile in Phase B
        user_defines.insert(
            key.into(),
            Self::parse(
                key,
                value_str,
                value_is_undefined,
                method_call_must_be_replaced_with_undefined_,
                log,
            )?,
        );
        Ok(())
    }

    pub fn parse(
        key: &[u8],
        value_str: &[u8],
        value_is_undefined: bool,
        method_call_must_be_replaced_with_undefined_: bool,
        log: &mut logger::Log,
    ) -> Result<DefineData, bun_core::Error> {
        // TODO(port): narrow error set
        let mut key_splitter = key.split(|b| *b == b'.');
        while let Some(part) = key_splitter.next() {
            if !js_lexer::is_identifier(part) {
                if strings::eql(part, key) {
                    log.add_error_fmt(
                        None,
                        logger::Loc::default(),
                        format_args!(
                            "define key \"{}\" must be a valid identifier",
                            bstr::BStr::new(key)
                        ),
                    )?;
                } else {
                    log.add_error_fmt(
                        None,
                        logger::Loc::default(),
                        format_args!(
                            "define key \"{}\" contains invalid identifier \"{}\"",
                            bstr::BStr::new(part),
                            bstr::BStr::new(value_str)
                        ),
                    )?;
                }
                break;
            }
        }

        // check for nested identifiers
        let mut value_splitter = value_str.split(|b| *b == b'.');
        let mut is_ident = true;

        while let Some(part) = value_splitter.next() {
            if !js_lexer::is_identifier(part) || js_lexer::Keywords::has(part) {
                is_ident = false;
                break;
            }
        }

        if is_ident {
            // Special-case undefined. it's not an identifier here
            // https://github.com/evanw/esbuild/issues/1407
            let value = if value_is_undefined || value_str == b"undefined" {
                js_ast::Expr::Data::EUndefined(js_ast::E::Undefined {})
            } else {
                js_ast::Expr::Data::EIdentifier(js_ast::E::Identifier {
                    ref_: Ref::NONE,
                    can_be_removed_if_unused: true,
                    ..Default::default()
                })
            };

            return Ok(DefineData {
                value,
                original_name_ptr: if !value_str.is_empty() {
                    NonNull::new(value_str.as_ptr() as *mut u8)
                } else {
                    None
                },
                original_name_len: value_str.len() as u32, // @truncate
                flags: Flags::new(
                    /* valueless: */ value_is_undefined,
                    /* can_be_removed_if_unused: */ true,
                    /* call_can_be_unwrapped_if_unused: */ js_ast::E::CallUnwrap::Never,
                    /* method_call_must_be_replaced_with_undefined: */
                    method_call_must_be_replaced_with_undefined_,
                ),
            });
        }
        let _log = log;
        let source = logger::Source {
            contents: value_str.into(),
            path: DEFINES_PATH,
            ..Default::default()
        };
        // TODO(port): json_parser module path — bun.json in Zig
        let expr = bun_json::parse_env_json(&source, _log)?;
        let cloned = expr.data.deep_clone()?;
        Ok(DefineData {
            value: cloned,
            original_name_ptr: if !value_str.is_empty() {
                NonNull::new(value_str.as_ptr() as *mut u8)
            } else {
                None
            },
            original_name_len: value_str.len() as u32, // @truncate
            flags: Flags::new(
                /* valueless: */ value_is_undefined,
                /* can_be_removed_if_unused: */ expr.is_primitive_literal(),
                /* call_can_be_unwrapped_if_unused: */ js_ast::E::CallUnwrap::Never,
                /* method_call_must_be_replaced_with_undefined: */
                method_call_must_be_replaced_with_undefined_,
            ),
        })
    }

    pub fn from_input(
        defines: &RawDefines,
        drop: &[&[u8]],
        log: &mut logger::Log,
    ) -> Result<UserDefines, bun_core::Error> {
        let mut user_defines = UserDefines::default();
        user_defines.reserve((defines.len() + drop.len()) as u32 as usize); // @truncate
        for (key, value) in defines.iter() {
            Self::from_mergeable_input_entry(&mut user_defines, key, value, false, false, log)?;
        }

        for drop_item in drop {
            if !drop_item.is_empty() {
                Self::from_mergeable_input_entry(&mut user_defines, drop_item, b"", true, true, log)?;
            }
        }

        Ok(user_defines)
    }
}

fn are_parts_equal(a: &[&[u8]], b: &[&[u8]]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    for i in 0..a.len() {
        if !strings::eql(a[i], b[i]) {
            return false;
        }
    }
    true
}

pub type IdentifierDefine = DefineData;

#[derive(Clone)]
pub struct DotDefine {
    // TODO(port): lifetime — `parts` either borrows into static tables
    // (global_no_side_effect_*) or into user-define key strings owned elsewhere.
    // Phase B should decide between &'static and an arena lifetime.
    pub parts: &'static [&'static [u8]],
    pub data: DefineData,
}

// var nan_val = try allocator.create(js_ast.E.Number);
#[allow(dead_code)]
const NAN_VAL: js_ast::E::Number = js_ast::E::Number { value: f64::NAN };

pub struct Define {
    pub identifiers: StringHashMap<IdentifierDefine>,
    pub dots: StringHashMap<Vec<DotDefine>>,
    pub drop_debugger: bool,
}

// Zig: `pub const Data = DefineData;` inside `Define`
// TODO(port): inherent associated type aliases are unstable; expose as module-level alias
pub type Data = DefineData;

impl Define {
    pub fn for_identifier(&self, name: &[u8]) -> Option<&IdentifierDefine> {
        if let Some(data) = self.identifiers.get(name) {
            return Some(data);
        }

        if let Some(id) = table::pure_global_identifier_map().get(name) {
            return Some(id.value());
        }

        None
    }

    // Zig: `comptime Iterator: type, iter: Iterator` — drop the type param per PORTING.md
    pub fn insert_from_iterator<'a, I>(&mut self, iter: I) -> Result<(), bun_alloc::AllocError>
    where
        I: Iterator<Item = (&'a [u8], &'a DefineData)>,
    {
        for (key, value) in iter {
            self.insert(key, value.clone())?;
        }
        Ok(())
    }

    pub fn insert(&mut self, key: &[u8], value: DefineData) -> Result<(), bun_alloc::AllocError> {
        // If it has a dot, then it's a DotDefine.
        // e.g. process.env.NODE_ENV
        if let Some(last_dot) = strings::last_index_of_char(key, b'.') {
            let tail = &key[last_dot + 1..key.len()];
            let remainder = &key[0..last_dot];
            let count = remainder.iter().filter(|&&b| b == b'.').count() + 1;
            let mut parts_vec: Vec<&[u8]> = Vec::with_capacity(count + 1);
            for split in remainder.split(|b| *b == b'.') {
                parts_vec.push(split);
            }
            parts_vec.push(tail);
            // TODO(port): lifetime — `parts` borrows into `key`, which the caller must keep
            // alive for the lifetime of `Define`. Zig stores raw slices and never frees them
            // individually. Phase B should arena-allocate or intern the key and derive 'static.
            // SAFETY: caller keeps `key` alive for the life of Define (matches Zig invariant).
            let parts: &'static [&'static [u8]] = unsafe {
                core::mem::transmute::<&[&[u8]], &'static [&'static [u8]]>(Box::leak(
                    parts_vec.into_boxed_slice(),
                ))
            };

            let mut initial_values: &[DotDefine] = &[];

            // "NODE_ENV"
            // PORT NOTE: reshaped for borrowck — getOrPut split into get/insert
            if let Some(existing) = self.dots.get_mut(tail) {
                for part in existing.iter_mut() {
                    // ["process", "env"] === ["process", "env"] (if that actually worked)
                    if are_parts_equal(part.parts, parts) {
                        part.data = DefineData::merge(part.data.clone(), value);
                        return Ok(());
                    }
                }

                initial_values = existing.as_slice();
            }

            let mut list: Vec<DotDefine> = Vec::with_capacity(initial_values.len() + 1);
            if !initial_values.is_empty() {
                // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
                list.extend_from_slice(initial_values);
            }

            // PERF(port): was appendAssumeCapacity — profile in Phase B
            list.push(DotDefine {
                data: value,
                // TODO: do we need to allocate this?
                parts,
            });
            self.dots.insert(tail.into(), list);
        } else {
            // e.g. IS_BROWSER
            self.identifiers.insert(key.into(), value);
        }
        Ok(())
    }

    fn insert_global(
        &mut self,
        global: &'static [&'static [u8]],
        value_define: &DefineData,
    ) -> Result<(), bun_alloc::AllocError> {
        let key = global[global.len() - 1];
        // PORT NOTE: reshaped for borrowck — getOrPut split into entry-style match
        if let Some(existing) = self.dots.get_mut(key) {
            let mut list: Vec<DotDefine> = Vec::with_capacity(existing.len() + 1);
            // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
            list.extend_from_slice(existing);
            // PERF(port): was appendAssumeCapacity — profile in Phase B
            list.push(DotDefine {
                parts: &global[0..global.len()],
                data: value_define.clone(),
            });

            // Zig: define.allocator.free(gpe.value_ptr.*); — handled by Vec drop on assign
            *existing = list;
        } else {
            let mut list: Vec<DotDefine> = Vec::with_capacity(1);
            // PERF(port): was appendAssumeCapacity — profile in Phase B
            list.push(DotDefine {
                parts: &global[0..global.len()],
                data: value_define.clone(),
            });

            self.dots.insert(key.into(), list);
        }
        Ok(())
    }

    pub fn init(
        _user_defines: Option<UserDefines>,
        string_defines: Option<UserDefinesArray>,
        drop_debugger: bool,
        omit_unused_global_calls: bool,
    ) -> Result<Box<Self>, bun_alloc::AllocError> {
        let mut define = Box::new(Define {
            identifiers: StringHashMap::default(),
            dots: StringHashMap::default(),
            drop_debugger,
        });
        define.dots.reserve(124);

        let value_define = DefineData {
            value: js_ast::Expr::Data::EUndefined(js_ast::E::Undefined {}),
            flags: Flags::new(
                /* valueless: */ true,
                /* can_be_removed_if_unused: */ true,
                /* call_can_be_unwrapped_if_unused: */ js_ast::E::CallUnwrap::Never,
                /* method_call_must_be_replaced_with_undefined: */ false,
            ),
            ..Default::default()
        };
        // Step 1. Load the globals into the hash tables
        for global in global_no_side_effect_property_accesses.iter() {
            define.insert_global(global, &value_define)?;
        }

        let to_string_safe = DefineData {
            value: js_ast::Expr::Data::EUndefined(js_ast::E::Undefined {}),
            flags: Flags::new(
                /* valueless: */ true,
                /* can_be_removed_if_unused: */ true,
                /* call_can_be_unwrapped_if_unused: */ js_ast::E::CallUnwrap::IfUnusedAndToStringSafe,
                /* method_call_must_be_replaced_with_undefined: */ false,
            ),
            ..Default::default()
        };

        if omit_unused_global_calls {
            for global in global_no_side_effect_function_calls_safe_for_to_string.iter() {
                define.insert_global(global, &to_string_safe)?;
            }
        } else {
            for global in global_no_side_effect_function_calls_safe_for_to_string.iter() {
                define.insert_global(global, &value_define)?;
            }
        }

        // Step 3. Load user data into hash tables
        // At this stage, user data has already been validated.
        if let Some(user_defines) = &_user_defines {
            define.insert_from_iterator(user_defines.iter().map(|(k, v)| (k.as_ref(), v)))?;
        }

        // Step 4. Load environment data into hash tables.
        // These are only strings. We do not parse them as JSON.
        if let Some(string_defines_) = &string_defines {
            define.insert_from_iterator(string_defines_.iter().map(|(k, v)| (k.as_ref(), v)))?;
        }

        Ok(define)
    }
}

// Zig `deinit` freed `dots` values, cleared maps, and destroyed `self`.
// In Rust: `dots: StringHashMap<Vec<DotDefine>>` and `identifiers` drop their
// contents automatically; `Box<Define>` frees `self`. No explicit Drop needed.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/defines.zig (429 lines)
//   confidence: medium
//   todos:      11
//   notes:      DotDefine.parts lifetime is the main hazard (borrows into key strings / static tables); Flags packed-struct ported as #[repr(transparent)] u8 with manual accessors; Expr::Data variant names are guesses pending js_ast port.
// ──────────────────────────────────────────────────────────────────────────
