use crate::jsc::{JSGlobalObject, JSValue, JsResult, bun_string_jsc};

use bun_sql::mysql::protocol::error_packet::{ErrorPacket, MySQLErrorOptions};

pub fn create_mysql_error(
    global: &JSGlobalObject,
    message: &[u8],
    options: MySQLErrorOptions,
) -> JsResult<JSValue> {
    let opts_obj = JSValue::create_empty_object(global, 0);
    opts_obj.ensure_still_alive();
    opts_obj.put(
        global,
        b"code",
        bun_string_jsc::create_utf8_for_js(global, options.code)?,
    );
    opts_obj.put_optional(global, b"errno", options.errno.map(f64::from));
    opts_obj.put_optional_utf8(
        global,
        b"sqlState",
        options.sql_state.as_ref().map(|s| &s[..]),
    )?;
    opts_obj.put(
        global,
        b"message",
        bun_string_jsc::create_utf8_for_js(global, message)?,
    );

    Ok(opts_obj)
}

pub trait ErrorPacketJsc {
    fn to_js(&self, global: &JSGlobalObject) -> JSValue;
}

impl ErrorPacketJsc for ErrorPacket {
    fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        let mut msg = self.error_message.slice();
        if msg.is_empty() {
            msg = b"MySQL error occurred";
        }

        create_mysql_error(
            global,
            msg,
            MySQLErrorOptions {
                code: if self.error_code == 1064 {
                    b"ERR_MYSQL_SYNTAX_ERROR"
                } else {
                    b"ERR_MYSQL_SERVER_ERROR"
                },
                errno: Some(self.error_code),
                sql_state: self.sql_state,
            },
        )
        .unwrap_or_else(|err| global.take_exception(err))
    }
}

// ported from: src/sql_jsc/mysql/protocol/error_packet_jsc.zig
