use crate::jsc::{JSGlobalObject, JSValue, JsResult, bun_string_jsc, create_sql_error};

use bun_sql::mysql::protocol::error_packet::{ErrorPacket, MySQLErrorOptions};

pub(crate) fn create_mysql_error(
    global: &JSGlobalObject,
    message: &[u8],
    options: &MySQLErrorOptions,
) -> JsResult<JSValue> {
    let error = create_sql_error(global, true, message)?;
    error.put(
        global,
        b"code",
        bun_string_jsc::create_utf8_for_js(global, options.code)?,
    );
    error.put_optional(global, b"errno", options.errno.map(f64::from));
    error.put_optional_utf8(
        global,
        b"sqlState",
        options.sql_state.as_ref().map(|s| &s[..]),
    )?;

    Ok(error)
}

pub(crate) trait ErrorPacketJsc {
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
            &MySQLErrorOptions {
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
