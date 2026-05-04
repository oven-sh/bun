use super::any_mysql_error;
use super::command_type::CommandType;
use super::new_reader::{decoder_wrap, NewReader};
use super::new_writer::{write_wrap, NewWriter};
use super::super::mysql_param::Param;
use super::super::mysql_types::Value;

bun_output::declare_scope!(PreparedStatement, hidden);

pub struct PrepareOK {
    pub status: u8,
    pub statement_id: u32,
    pub num_columns: u16,
    pub num_params: u16,
    pub warning_count: u16,
}

impl Default for PrepareOK {
    fn default() -> Self {
        Self {
            status: 0,
            statement_id: 0,
            num_columns: 0,
            num_params: 0,
            warning_count: 0,
        }
    }
}

impl PrepareOK {
    // TODO(port): narrow error set
    pub fn decode_internal<C>(&mut self, reader: NewReader<C>) -> Result<(), bun_core::Error> {
        self.status = reader.int::<u8>()?;
        if self.status != 0 {
            return Err(bun_core::err!("InvalidPrepareOKPacket"));
        }

        self.statement_id = reader.int::<u32>()?;
        self.num_columns = reader.int::<u16>()?;
        self.num_params = reader.int::<u16>()?;
        let _ = reader.int::<u8>()?; // reserved_1
        self.warning_count = reader.int::<u16>()?;
        Ok(())
    }

    // TODO(port): `decoderWrap(PrepareOK, decodeInternal).decode` is a comptime type-generator
    // that produces a wrapped `decode` fn. Phase B should express this as a trait impl or macro.
    pub fn decode<C>(&mut self, reader: NewReader<C>) -> Result<(), bun_core::Error> {
        decoder_wrap::<PrepareOK, C>(Self::decode_internal, self, reader)
    }
}

pub struct Execute {
    /// ID of the prepared statement to execute, returned from COM_STMT_PREPARE
    pub statement_id: u32,
    /// Execution flags. Currently only CURSOR_TYPE_READ_ONLY (0x01) is supported
    pub flags: u8,
    /// Number of times to execute the statement (usually 1)
    pub iteration_count: u32,
    /// Parameter values to bind to the prepared statement
    pub params: Vec<Value>,
    /// Types of each parameter in the prepared statement
    // TODO(port): lifetime — borrowed from statement metadata, not owned; using &'static in Phase A
    pub param_types: &'static [Param],
    /// Whether to send parameter types. Set to true for first execution, false for subsequent executions
    pub new_params_bind_flag: bool,
}

impl Default for Execute {
    fn default() -> Self {
        Self {
            statement_id: 0,
            flags: 0,
            iteration_count: 1,
            params: Vec::new(),
            param_types: &[],
            new_params_bind_flag: false,
        }
    }
}

// PORT NOTE: Zig `deinit` only freed `params` (and each Value inside) via default_allocator.
// `Vec<Value>` + `impl Drop for Value` handle both automatically — no explicit Drop needed.

impl Execute {
    fn write_null_bitmap<C>(&self, writer: NewWriter<C>) -> Result<(), any_mysql_error::Error> {
        const MYSQL_MAX_PARAMS: usize = (u16::MAX as usize / 8) + 1;

        let mut null_bitmap_buf = [0u8; MYSQL_MAX_PARAMS];
        let bitmap_bytes = (self.params.len() + 7) / 8;
        let null_bitmap = &mut null_bitmap_buf[0..bitmap_bytes];
        null_bitmap.fill(0);

        for (i, param) in self.params.iter().enumerate() {
            if matches!(param, Value::Null) {
                null_bitmap[i >> 3] |= 1u8 << ((i & 7) as u8);
            }
        }

        writer.write(null_bitmap)?;
        Ok(())
    }

    pub fn write_internal<C>(&self, writer: NewWriter<C>) -> Result<(), any_mysql_error::Error> {
        writer.int1(CommandType::COM_STMT_EXECUTE as u8)?;
        writer.int4(self.statement_id)?;
        writer.int1(self.flags)?;
        writer.int4(self.iteration_count)?;

        if !self.params.is_empty() {
            self.write_null_bitmap(writer)?;

            // Write new params bind flag
            writer.int1(self.new_params_bind_flag as u8)?;

            if self.new_params_bind_flag {
                // Write parameter types
                for param_type in self.param_types.iter() {
                    bun_output::scoped_log!(
                        PreparedStatement,
                        "New params bind flag {} unsigned? {}",
                        <&'static str>::from(param_type.r#type),
                        param_type.flags.unsigned
                    );
                    writer.int1(param_type.r#type as u8)?;
                    writer.int1(if param_type.flags.unsigned { 0x80 } else { 0 })?;
                }
            }

            // Write parameter values
            debug_assert_eq!(self.params.len(), self.param_types.len());
            for (param, param_type) in self.params.iter().zip(self.param_types.iter()) {
                if matches!(param, Value::Null) || param_type.r#type.is_null() {
                    // TODO(port): Zig checks `param_type.type == .MYSQL_TYPE_NULL`; assuming an
                    // `is_null()` helper or `== FieldType::MYSQL_TYPE_NULL` — adjust in Phase B.
                    continue;
                }

                let value = param.to_data(param_type.r#type)?;
                // PORT NOTE: Zig `defer value.deinit()` — handled by Drop on `value`.
                if param_type.r#type.is_binary_format_supported() {
                    writer.write(value.slice())?;
                } else {
                    writer.write_length_encoded_string(value.slice())?;
                }
            }
        }
        Ok(())
    }

    // TODO(port): `writeWrap(Execute, writeInternal).write` is a comptime type-generator
    // that produces a wrapped `write` fn. Phase B should express this as a trait impl or macro.
    pub fn write<C>(&self, writer: NewWriter<C>) -> Result<(), any_mysql_error::Error> {
        write_wrap::<Execute, C>(Self::write_internal, self, writer)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/PreparedStatement.zig (118 lines)
//   confidence: medium
//   todos:      4
//   notes:      decoder_wrap/write_wrap comptime type-generators stubbed; param_types lifetime needs Phase B; NewReader/NewWriter passed by value (may need &mut)
// ──────────────────────────────────────────────────────────────────────────
