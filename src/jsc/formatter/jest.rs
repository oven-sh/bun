//! [`Style::Jest`]: the text of `bun:test` snapshots and assertion diffs.
//!
//! Layout only. Classifying a value, guarding the descent and walking
//! properties belong to the shared formatter, and every nested value goes
//! back through [`Formatter::format`]. Stored snapshots depend on this text
//! byte for byte. It is never colored.

use super::*;

/// A hole prints as a line of `undefined`. An array can claim 2^32 - 1 of them
/// and hold nothing.
const MAX_HOLES_PRINTED_ONE_BY_ONE: u32 = 1000;

impl<'a> Formatter<'a> {
    #[inline(always)]
    pub(super) fn dispatch_jest(
        &mut self,
        entered: &Entered,
        format: Tag,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
        js_type: jsc::JSType,
    ) -> JsResult<()> {
        match format {
            Tag::StringPossiblyFormatted | Tag::String => {
                self.print_jest_string(writer_, value, js_type)
            }
            Tag::Integer => self.print_integer::<false>(writer_, value),
            Tag::BigInt => self.print_bigint::<false>(writer_, value),
            Tag::Undefined => self.print_undefined::<false>(writer_),
            Tag::Null => self.print_null::<false>(writer_),
            Tag::Double if !value.is_cell() => self.print_double::<false>(writer_, value),
            Tag::Boolean if !value.is_cell() => self.print_boolean::<false>(writer_, value),
            // A boxed primitive prints as an object, which can hold values,
            // and it entered as a leaf.
            Tag::Double | Tag::Boolean => {
                self.print_as::<false>(Tag::Object, writer_, value, jsc::JSType::Object)
            }
            Tag::Symbol => self.print_jest_symbol(writer_, value),
            Tag::Error => self.print_jest_error(entered, writer_, value),
            Tag::Class => self.print_jest_class(writer_, value),
            Tag::Function => self.print_jest_function(writer_, value),
            Tag::Array => self.print_jest_array(entered, writer_, value),
            Tag::Private => self.print_jest_private(entered, writer_, value, js_type),
            Tag::NativeCode | Tag::GetterSetter | Tag::CustomGetterSetter => {
                self.add_for_new_line("[native code]".len());
                self.put(writer_, b"[native code]");
                Ok(())
            }
            Tag::Promise => self.print_jest_promise(writer_),
            Tag::GlobalObject => self.print_global_object::<false>(writer_),
            Tag::Map => self.print_jest_map(entered, writer_, value),
            Tag::Set => self.print_jest_set(entered, writer_, value),
            Tag::JSON | Tag::ToJSON => self.print_jest_json(writer_, value, js_type),
            Tag::Event => self.print_event::<false>(entered, writer_, value),
            Tag::JSX => self.print_jsx::<false>(entered, writer_, value),
            Tag::Object | Tag::MapIterator | Tag::SetIterator | Tag::CustomFormattedObject => {
                self.print_jest_object(entered, writer_, value, js_type)
            }
            Tag::TypedArray => self.print_jest_typed_array(writer_, value, js_type),
            Tag::RevokedProxy => self.print_revoked_proxy::<false>(writer_),
            Tag::Proxy => self.print_proxy::<false>(entered, writer_, value),
        }
    }

    #[inline]
    fn put(&mut self, writer_: &mut dyn bun_io::Write, bytes: &[u8]) {
        if writer_.write_all(bytes).is_err() {
            self.failed = true;
        }
    }

    #[inline]
    fn putf(&mut self, writer_: &mut dyn bun_io::Write, args: core::fmt::Arguments<'_>) {
        if writer_.write_fmt(args).is_err() {
            self.failed = true;
        }
    }

    /// Stored snapshots stop indenting at 32 levels.
    fn put_jest_indent(&mut self, writer_: &mut dyn bun_io::Write) {
        if write_indent_n(self.indent.min(32), writer_).is_err() {
            self.failed = true;
        }
    }

    fn put_jest_comma(&mut self, writer_: &mut dyn bun_io::Write) {
        self.put(writer_, b",");
        self.estimated_line_length += 1;
    }

    #[inline(never)]
    fn print_jest_string(
        &mut self,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
        js_type: jsc::JSType,
    ) -> JsResult<()> {
        let is_string_object = matches!(
            value.js_type(),
            jsc::JSType::StringObject | jsc::JSType::DerivedStringObject
        );
        use crate::StringJsc as _;
        let owned = if js_type == jsc::JSType::RegExpObject {
            reader::reg_exp_source(value)
        } else {
            BunString::from_js(reader::boxed_primitive(value), self.global_this)?
        };
        let str = owned.to_encoded_slice();
        self.add_for_new_line(str.len);

        if is_string_object {
            if str.len == 0 {
                self.put(writer_, b"String {}");
                return Ok(());
            }
            if self.indent == 0 {
                self.put(writer_, b"\n");
            }
            self.put(writer_, b"String {\n");
            self.indent += 1;
            self.reset_line();
            self.put_jest_indent(writer_);
            let length = str.len;
            for (i, c) in str.slice().iter().enumerate() {
                self.putf(writer_, format_args!("\"{}\": \"{}\",\n", i, *c as char));
                if i != length - 1 {
                    self.put_jest_indent(writer_);
                }
            }
            self.reset_line();
            self.put(writer_, b"}\n");
            self.indent = self.indent.saturating_sub(1);
            return Ok(());
        }

        if self.quote_strings && js_type != jsc::JSType::RegExpObject {
            if str.len == 0 {
                self.put(writer_, b"\"\"");
                return Ok(());
            }

            let has_newline = str.index_of_any(b"\n\r").is_some();
            if has_newline {
                self.put(writer_, b"\n");
            }

            self.put(writer_, b"\"");
            let mut remaining = str;
            while let Some(i) = remaining.index_of_any(b"\\\r") {
                let head = remaining.substring_with_len(0, i);
                if remaining.char_at(i) == u16::from(b'\\') {
                    self.putf(writer_, format_args!("{head}\\"));
                } else if i + 1 < remaining.len && remaining.char_at(i + 1) == u16::from(b'\n') {
                    self.putf(writer_, format_args!("{head}"));
                } else {
                    self.putf(writer_, format_args!("{head}\n"));
                }
                remaining = remaining.substring(i + 1);
            }
            self.putf(writer_, format_args!("{remaining}"));
            self.put(writer_, b"\"");

            if has_newline {
                self.put(writer_, b"\n");
            }
            return Ok(());
        }

        if str.is_16bit() {
            self.putf(writer_, format_args!("{str}"));
        } else if strings::is_all_ascii(str.slice()) {
            self.put(writer_, str.slice());
        } else if str.len > 0 {
            let buf = strings::allocate_latin1_into_utf8(str.slice()).unwrap_or_default();
            self.put(writer_, &buf);
        }
        Ok(())
    }

    #[inline(never)]
    fn print_jest_symbol(
        &mut self,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
    ) -> JsResult<()> {
        let description = value.get_description(self.global_this);
        self.add_for_new_line("Symbol".len());
        if description.is_empty() {
            self.put(writer_, b"Symbol");
        } else {
            self.add_for_new_line(description.length() + "()".len());
            self.putf(writer_, format_args!("Symbol({description})"));
        }
        Ok(())
    }

    #[inline(never)]
    fn print_jest_error(
        &mut self,
        _entered: &Entered,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
    ) -> JsResult<()> {
        let classname = value.get_class_name(self.global_this)?;
        let message = match value.fast_get(self.global_this, jsc::BuiltinName::Message)? {
            Some(message) => message.to_bun_string(self.global_this)?,
            None => BunString::EMPTY,
        };
        if message.is_empty() {
            self.putf(writer_, format_args!("[{classname}]"));
        } else {
            self.putf(writer_, format_args!("[{classname}: {message}]"));
        }
        Ok(())
    }

    #[inline(never)]
    fn print_jest_class(
        &mut self,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
    ) -> JsResult<()> {
        let printable = value.get_class_name(self.global_this)?;
        self.add_for_new_line(printable.length());
        if printable.is_empty() {
            self.put(writer_, b"[class]");
        } else {
            self.putf(writer_, format_args!("[class {printable}]"));
        }
        Ok(())
    }

    #[inline(never)]
    fn print_jest_function(
        &mut self,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
    ) -> JsResult<()> {
        let printable = value.get_name_property(self.global_this)?;
        if printable.is_empty() {
            self.put(writer_, b"[Function]");
        } else {
            self.putf(writer_, format_args!("[Function: {printable}]"));
        }
        Ok(())
    }

    #[inline(never)]
    fn print_jest_array(
        &mut self,
        _entered: &Entered,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
    ) -> JsResult<()> {
        let len = reader::array_length(self.global_this, value).min(u64::from(u32::MAX)) as u32;
        if len == 0 {
            self.put(writer_, b"[]");
            self.add_for_new_line(2);
            return Ok(());
        }

        if self.indent == 0 {
            self.put(writer_, b"\n");
        }

        {
            self.indent += 1;
            let _indent = defer_decrement!(self.indent);
            self.add_for_new_line(2);
            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = defer_restore!(self.quote_strings, prev_quote_strings);

            self.reset_line();
            self.put(writer_, b"[");
            self.add_for_new_line(1);

            let mut i: u32 = 0;
            while i < len {
                self.put(writer_, b"\n");
                self.put_jest_indent(writer_);
                let element = value.get_index(self.global_this, i)?;
                if element.is_undefined() {
                    let holes = value
                        .next_present_index(i)
                        .map_or(len, |next| next.min(len))
                        - i;
                    if holes > MAX_HOLES_PRINTED_ONE_BY_ONE {
                        self.print_jest_holes(writer_, holes)?;
                        i += holes;
                        continue;
                    }
                }
                let tag = self.tag_of(element)?;
                self.format::<false>(tag, writer_, element, self.global_this)?;
                self.put_jest_comma(writer_);
                i += 1;
            }
        }

        self.reset_line();
        self.put(writer_, b"\n");
        self.put_jest_indent(writer_);
        self.put(writer_, b"]");
        if self.indent == 0 {
            self.put(writer_, b"\n");
        }
        self.reset_line();
        self.add_for_new_line(1);
        Ok(())
    }

    #[cold]
    fn print_jest_holes(&mut self, writer_: &mut dyn bun_io::Write, holes: u32) -> JsResult<()> {
        if self.is_exact() {
            return Err(self.global_this.throw(format_args!(
                "Snapshot value is too large to serialize: an array has {holes} empty items in a row. Snapshot a smaller part of the value."
            )));
        }
        self.putf(writer_, format_args!("{holes} x empty items"));
        self.put_jest_comma(writer_);
        Ok(())
    }

    #[inline(never)]
    fn print_jest_private(
        &mut self,
        entered: &Entered,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
        js_type: jsc::JSType,
    ) -> JsResult<()> {
        if let Some(hooks) = crate::virtual_machine::runtime_hooks() {
            if (hooks.console_print_runtime_object)(self, writer_, value, false)? {
                return Ok(());
            }
        }

        if crate::DOMFormData::from_js(value).is_some() {
            if let Some(to_json) = value
                .get(self.global_this, "toJSON")?
                .filter(|f| f.is_callable())
            {
                self.add_for_new_line("FormData (entries) ".len());
                self.put(writer_, b"FormData (entries) ");
                let entries = to_json.call(self.global_this, value, &[])?;
                return self.print_as::<false>(Tag::Object, writer_, entries, jsc::JSType::Object);
            }
        } else if js_type != jsc::JSType::DOMWrapper {
            if value.is_callable() {
                return self.print_jest_function(writer_, value);
            }
            return self.print_jest_object(entered, writer_, value, js_type);
        }
        self.print_jest_object(entered, writer_, value, jsc::JSType::Event)
    }

    #[inline(never)]
    fn print_jest_promise(&mut self, writer_: &mut dyn bun_io::Write) -> JsResult<()> {
        if self.good_time_for_a_new_line() {
            self.put(writer_, b"\n");
            self.put_jest_indent(writer_);
        }
        self.put(writer_, b"Promise {}");
        Ok(())
    }

    #[inline(never)]
    fn print_jest_map(
        &mut self,
        _entered: &Entered,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
    ) -> JsResult<()> {
        let name = if value.js_type() == jsc::JSType::WeakMap {
            "WeakMap"
        } else {
            "Map"
        };
        let size = reader::collection_size(self.global_this, value)?;
        if size == 0 {
            self.putf(writer_, format_args!("{name} {{}}"));
            return Ok(());
        }

        self.putf(writer_, format_args!("\n{name} {{\n"));
        {
            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = defer_restore!(self.quote_strings, prev_quote_strings);
            self.indent += 1;
            let _indent = defer_decrement!(self.indent);
            let global_this = self.global_this;
            let mut iter = JestEntries {
                formatter: self,
                writer: writer_,
            };
            let truncated = reader::for_each_entry(
                value,
                global_this,
                size,
                (&raw mut iter).cast::<c_void>(),
                JestEntries::map_entry,
            )?;
            if truncated {
                self.put_jest_indent(writer_);
                self.put(writer_, b"... more items\n");
            }
        }
        self.put_jest_indent(writer_);
        self.put(writer_, b"}\n");
        Ok(())
    }

    #[inline(never)]
    fn print_jest_set(
        &mut self,
        _entered: &Entered,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
    ) -> JsResult<()> {
        let size = reader::collection_size(self.global_this, value)?;
        self.put_jest_indent(writer_);
        let name = if value.js_type() == jsc::JSType::WeakSet {
            "WeakSet"
        } else {
            "Set"
        };
        if size == 0 {
            self.putf(writer_, format_args!("{name} {{}}"));
            return Ok(());
        }

        self.putf(writer_, format_args!("\n{name} {{\n"));
        {
            let prev_quote_strings = self.quote_strings;
            self.quote_strings = true;
            let _qs = defer_restore!(self.quote_strings, prev_quote_strings);
            self.indent += 1;
            let _indent = defer_decrement!(self.indent);
            let global_this = self.global_this;
            let mut iter = JestEntries {
                formatter: self,
                writer: writer_,
            };
            let truncated = reader::for_each_entry(
                value,
                global_this,
                size,
                (&raw mut iter).cast::<c_void>(),
                JestEntries::set_entry,
            )?;
            if truncated {
                self.put_jest_indent(writer_);
                self.put(writer_, b"... more items\n");
            }
        }
        self.put_jest_indent(writer_);
        self.put(writer_, b"}\n");
        Ok(())
    }

    #[inline(never)]
    fn print_jest_json(
        &mut self,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
        js_type: jsc::JSType,
    ) -> JsResult<()> {
        let str = value.json_stringify(self.global_this, self.indent)?;
        self.add_for_new_line(str.length());
        if js_type != jsc::JSType::JSDate {
            self.putf(writer_, format_args!("{str}"));
            return Ok(());
        }

        // An ISO date never exceeds this.
        let mut iso_string_buf = [0u8; 36];
        let mut out_buf: &[u8] = {
            use std::io::Write as _;
            let mut cursor = &mut iso_string_buf[..];
            let start_len = cursor.len();
            match write!(cursor, "{str}") {
                Ok(()) => {
                    let written = start_len - cursor.len();
                    &iso_string_buf[..written]
                }
                Err(_) => b"",
            }
        };
        if out_buf.len() > 2 {
            // trim the quotes
            out_buf = &out_buf[1..out_buf.len() - 1];
        }
        self.put(writer_, out_buf);
        Ok(())
    }

    #[inline(never)]
    fn print_jest_object(
        &mut self,
        _entered: &Entered,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
        _js_type: jsc::JSType,
    ) -> JsResult<()> {
        let prev_quote_strings = self.quote_strings;
        self.quote_strings = true;
        let _qs = defer_restore!(self.quote_strings, prev_quote_strings);
        // Resets a long line, which `print_jest_promise` reads.
        self.good_time_for_a_new_line();

        let global_this = self.global_this;
        let mut iter = JestProperties {
            formatter: self,
            writer: writer_,
            i: 0,
            parent: value,
        };
        reader::for_each_property(
            value,
            global_this,
            reader::PropertyWalk::OwnSorted,
            (&raw mut iter).cast::<c_void>(),
            JestProperties::for_each,
        )?;
        let count = iter.i;

        if count == 0 {
            let object_name = value.get_class_name(self.global_this)?;
            if object_name.eq_ascii(b"Object") {
                self.put(writer_, b"{}");
            } else {
                self.putf(writer_, format_args!("{object_name} {{}}"));
            }
            return Ok(());
        }

        self.put_jest_comma(writer_);
        self.indent = self.indent.saturating_sub(1);
        self.put(writer_, b"\n");
        self.put_jest_indent(writer_);
        self.put(writer_, b"}");
        self.estimated_line_length += 1;
        if self.indent == 0 {
            self.put(writer_, b"\n");
        }
        Ok(())
    }

    #[inline(never)]
    fn print_jest_typed_array(
        &mut self,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
        js_type: jsc::JSType,
    ) -> JsResult<()> {
        let array_buffer = value.as_array_buffer(self.global_this).unwrap();
        let slice = array_buffer.byte_slice();

        if self.indent == 0 && !slice.is_empty() {
            self.put(writer_, b"\n");
        }

        if js_type == jsc::JSType::Uint8Array
            && value.get_class_name(self.global_this)?.eq_ascii(b"Buffer")
        {
            if slice.is_empty() && self.indent == 0 {
                self.put(writer_, b"\n");
            }
            self.put(writer_, b"{\n");
            self.indent += 1;
            self.put_jest_indent(writer_);
            self.put(writer_, b"\"data\": [");

            self.indent += 1;
            for el in slice {
                self.put(writer_, b"\n");
                self.put_jest_indent(writer_);
                self.putf(writer_, format_args!("{el},"));
            }
            self.indent = self.indent.saturating_sub(1);

            if !slice.is_empty() {
                self.put(writer_, b"\n");
                self.put_jest_indent(writer_);
            }
            self.put(writer_, b"],\n");

            self.put_jest_indent(writer_);
            self.put(writer_, b"\"type\": \"Buffer\",\n");

            self.indent = self.indent.saturating_sub(1);
            self.put_jest_indent(writer_);
            self.put(writer_, b"}");
            if self.indent == 0 {
                self.put(writer_, b"\n");
            }
            return Ok(());
        }

        self.put(writer_, array_buffer.typed_array_type.typed_array_name());
        self.put(writer_, b" [");
        if slice.is_empty() {
            self.put(writer_, b"]");
            return Ok(());
        }

        macro_rules! elements {
            ($t:ty) => {{
                self.indent += 1;
                for el in slice.chunks_exact(core::mem::size_of::<$t>()) {
                    self.put(writer_, b"\n");
                    self.put_jest_indent(writer_);
                    let el: $t = bytemuck::pod_read_unaligned(el);
                    self.putf(writer_, format_args!("{el},"));
                }
                self.indent = self.indent.saturating_sub(1);
            }};
        }
        use jsc::JSType as T;
        match js_type {
            T::Int8Array => elements!(i8),
            T::Int16Array => elements!(i16),
            T::Uint16Array => elements!(u16),
            T::Int32Array => elements!(i32),
            T::Uint32Array => elements!(u32),
            T::Float16Array => elements!(bun_core::f16),
            T::Float32Array => elements!(f32),
            T::Float64Array => elements!(f64),
            T::BigInt64Array => elements!(i64),
            T::BigUint64Array => elements!(u64),
            // Uint8Array, Uint8ClampedArray, DataView, ArrayBuffer
            _ => elements!(u8),
        }

        self.put(writer_, b"\n");
        self.put_jest_indent(writer_);
        self.put(writer_, b"]");
        if self.indent == 0 {
            self.put(writer_, b"\n");
        }
        Ok(())
    }
}

struct JestEntries<'a, 'b> {
    formatter: &'a mut Formatter<'b>,
    writer: &'a mut dyn bun_io::Write,
}

impl JestEntries<'_, '_> {
    fn value(&mut self, value: JSValue) -> bool {
        let Ok(tag) = self.formatter.tag_of(value) else {
            return false;
        };
        let global_this = self.formatter.global_this;
        self.formatter
            .format::<false>(tag, self.writer, value, global_this)
            .is_ok()
    }

    extern "C" fn map_entry(ctx: *mut c_void, key: JSValue, value: JSValue) {
        // SAFETY: `ctx` is the stack-allocated `Self` the caller of `for_each` passed.
        let Some(this) = (unsafe { ctx.cast::<Self>().as_mut() }) else {
            return;
        };
        if this.formatter.failed {
            return;
        }
        this.formatter.put_jest_indent(this.writer);
        if !this.value(key) {
            return;
        }
        this.formatter.put(this.writer, b" => ");
        if !this.value(value) {
            return;
        }
        this.formatter.put_jest_comma(this.writer);
        this.formatter.put(this.writer, b"\n");
    }

    extern "C" fn set_entry(ctx: *mut c_void, next_value: JSValue, _: JSValue) {
        // SAFETY: `ctx` is the stack-allocated `Self` the caller of `for_each` passed.
        let Some(this) = (unsafe { ctx.cast::<Self>().as_mut() }) else {
            return;
        };
        if this.formatter.failed {
            return;
        }
        this.formatter.put_jest_indent(this.writer);
        if !this.value(next_value) {
            return;
        }
        this.formatter.put_jest_comma(this.writer);
        this.formatter.put(this.writer, b"\n");
    }
}

struct JestProperties<'a, 'b> {
    formatter: &'a mut Formatter<'b>,
    writer: &'a mut dyn bun_io::Write,
    i: usize,
    parent: JSValue,
}

impl JestProperties<'_, '_> {
    fn open(&mut self, global_this: &JSGlobalObject) -> JsResult<()> {
        let value = self.parent;
        if !value.js_type().is_function() {
            let mut name = value.get_name_property(global_this)?;
            if name.is_empty() || name.eq_ascii(b"Object") {
                name = value
                    .get_prototype(global_this)?
                    .get_name_property(global_this)?;
            }
            if !name.is_empty() && !name.eq_ascii(b"Object") {
                self.formatter.putf(self.writer, format_args!("{name} "));
            }
        }

        self.formatter.estimated_line_length = (self.formatter.indent as usize) * 2 + 1;
        if self.formatter.indent == 0 {
            self.formatter.put(self.writer, b"\n");
        }
        let classname = value.get_class_name(global_this)?;
        if !classname.is_empty() && !classname.eq_ascii(b"Object") {
            self.formatter
                .putf(self.writer, format_args!("{classname} "));
        }
        self.formatter.put(self.writer, b"{\n");
        self.formatter.indent += 1;
        self.formatter.put_jest_indent(self.writer);
        Ok(())
    }

    fn key(&mut self, key: &EncodedSlice, is_symbol: bool) {
        let this = &mut *self.formatter;
        if is_symbol {
            this.add_for_new_line(1 + "[Symbol()]:".len() + key.len);
            this.putf(self.writer, format_args!("[Symbol({key})]: "));
        } else if (!key.is_16bit() && JSLexer::is_latin1_identifier_u8(key.slice()))
            || (key.is_16bit() && JSLexer::is_latin1_identifier_u16(key.utf16_slice()))
        {
            this.add_for_new_line(key.len + 2);
            this.putf(self.writer, format_args!("\"{key}\": "));
        } else if key.is_16bit() {
            this.add_for_new_line(key.len + 2);
            this.putf(
                self.writer,
                format_args!(
                    "\"{}\": ",
                    bun_core::fmt::FormatUTF16 {
                        buf: key.utf16_slice(),
                        path_fmt_opts: None
                    }
                ),
            );
        } else {
            this.add_for_new_line(key.len + 2);
            this.putf(
                self.writer,
                format_args!(
                    "{}: ",
                    bun_core::fmt::format_json_string_latin1(key.slice())
                ),
            );
        }
    }

    extern "C" fn for_each(
        global_this: &JSGlobalObject,
        ctx_ptr: *mut c_void,
        key: *mut EncodedSlice,
        value: JSValue,
        is_symbol: bool,
        is_private_symbol: bool,
    ) {
        if is_private_symbol {
            return;
        }
        // SAFETY: the walker passes a valid `*EncodedSlice`.
        let key = unsafe { &*key };
        if key.eq_ascii(b"constructor") {
            return;
        }
        // SAFETY: `ctx_ptr` is the stack-allocated `Self` the caller of the walk passed.
        let Some(ctx) = (unsafe { ctx_ptr.cast::<Self>().as_mut() }) else {
            return;
        };
        if ctx.formatter.failed {
            return;
        }
        let Ok(tag) = ctx.formatter.tag_of(value) else {
            return;
        };
        if tag.cell.is_hidden() {
            return;
        }

        if ctx.i == 0 {
            if ctx.open(global_this).is_err() {
                return;
            }
        } else {
            ctx.formatter.put_jest_comma(ctx.writer);
            ctx.formatter.put(ctx.writer, b"\n");
            ctx.formatter.put_jest_indent(ctx.writer);
            ctx.formatter.reset_line();
        }
        ctx.i += 1;

        ctx.key(key, is_symbol);
        let format_global = ctx.formatter.global_this;
        let _ = ctx
            .formatter
            .format::<false>(tag, ctx.writer, value, format_global);
    }
}
