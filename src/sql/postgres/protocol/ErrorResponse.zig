const ErrorResponse = @This();

messages: std.ArrayListUnmanaged(FieldMessage) = .{},

pub fn format(formatter: ErrorResponse, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
    for (formatter.messages.items) |message| {
        try std.fmt.format(writer, "{}\n", .{message});
    }
}

pub fn deinit(this: *ErrorResponse) void {
    for (this.messages.items) |*message| {
        message.deinit();
    }
    this.messages.deinit(bun.default_allocator);
}

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
    var remaining_bytes = try reader.length();
    if (remaining_bytes < 4) return error.InvalidMessageLength;
    remaining_bytes -|= 4;

    if (remaining_bytes > 0) {
        this.* = .{
            .messages = try FieldMessage.decodeList(Container, reader),
        };
    }
}

pub const decode = DecoderWrap(ErrorResponse, decodeInternal).decode;

// PostgreSQL Error Code Constants
const UNIQUE_VIOLATION = "23505";
const NOT_NULL_VIOLATION = "23502";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const SYNTAX_ERROR = "42601";
const UNDEFINED_TABLE = "42P01";
const UNDEFINED_COLUMN = "42703";

const ERROR_CODE_MAP = std.StaticStringMap([]const u8).initComptime(.{
    .{ "00000", "successful_completion" },
    .{ "01000", "warning" },
    .{ "0100C", "dynamic_result_sets_returned" },
    .{ "01008", "implicit_zero_bit_padding" },
    .{ "01003", "null_value_eliminated_in_set_function" },
    .{ "01007", "privilege_not_granted" },
    .{ "01006", "privilege_not_revoked" },
    .{ "01004", "string_data_right_truncation" },
    .{ "01P01", "deprecated_feature" },
    .{ "02000", "no_data" },
    .{ "02001", "no_additional_dynamic_result_sets_returned" },
    .{ "03000", "sql_statement_not_yet_complete" },
    .{ "08000", "connection_exception" },
    .{ "08003", "connection_does_not_exist" },
    .{ "08006", "connection_failure" },
    .{ "08001", "sqlclient_unable_to_establish_sqlconnection" },
    .{ "08004", "sqlserver_rejected_establishment_of_sqlconnection" },
    .{ "08007", "transaction_resolution_unknown" },
    .{ "08P01", "protocol_violation" },
    .{ "09000", "triggered_action_exception" },
    .{ "0A000", "feature_not_supported" },
    .{ "0B000", "invalid_transaction_initiation" },
    .{ "0F000", "locator_exception" },
    .{ "0F001", "invalid_locator_specification" },
    .{ "0L000", "invalid_grantor" },
    .{ "0LP01", "invalid_grant_operation" },
    .{ "0P000", "invalid_role_specification" },
    .{ "0Z000", "diagnostics_exception" },
    .{ "0Z002", "stacked_diagnostics_accessed_without_active_handler" },
    .{ "20000", "case_not_found" },
    .{ "21000", "cardinality_violation" },
    .{ "22000", "data_exception" },
    .{ "2202E", "array_subscript_error" },
    .{ "22021", "character_not_in_repertoire" },
    .{ "22008", "datetime_field_overflow" },
    .{ "22012", "division_by_zero" },
    .{ "22005", "error_in_assignment" },
    .{ "2200B", "escape_character_conflict" },
    .{ "22022", "indicator_overflow" },
    .{ "22015", "interval_field_overflow" },
    .{ "2201E", "invalid_argument_for_logarithm" },
    .{ "22014", "invalid_argument_for_ntile_function" },
    .{ "22016", "invalid_argument_for_nth_value_function" },
    .{ "2201F", "invalid_argument_for_power_function" },
    .{ "2201G", "invalid_argument_for_width_bucket_function" },
    .{ "22018", "invalid_character_value_for_cast" },
    .{ "22007", "invalid_datetime_format" },
    .{ "22019", "invalid_escape_character" },
    .{ "2200D", "invalid_escape_octet" },
    .{ "22025", "invalid_escape_sequence" },
    .{ "22P06", "nonstandard_use_of_escape_character" },
    .{ "22010", "invalid_indicator_parameter_value" },
    .{ "22023", "invalid_parameter_value" },
    .{ "2201B", "invalid_regular_expression" },
    .{ "2201W", "invalid_row_count_in_limit_clause" },
    .{ "2201X", "invalid_row_count_in_result_offset_clause" },
    .{ "2202H", "invalid_tablesample_argument" },
    .{ "2202G", "invalid_tablesample_repeat" },
    .{ "22009", "invalid_time_zone_displacement_value" },
    .{ "2200C", "invalid_use_of_escape_character" },
    .{ "2200G", "most_specific_type_mismatch" },
    .{ "22004", "null_value_not_allowed" },
    .{ "22002", "null_value_no_indicator_parameter" },
    .{ "22003", "numeric_value_out_of_range" },
    .{ "2200H", "sequence_generator_limit_exceeded" },
    .{ "22026", "string_data_length_mismatch" },
    .{ "22001", "string_data_right_truncation" },
    .{ "22011", "substring_error" },
    .{ "22027", "trim_error" },
    .{ "22024", "unterminated_c_string" },
    .{ "2200F", "zero_length_character_string" },
    .{ "22P01", "floating_point_exception" },
    .{ "22P02", "invalid_text_representation" },
    .{ "22P03", "invalid_binary_representation" },
    .{ "22P04", "bad_copy_file_format" },
    .{ "22P05", "untranslatable_character" },
    .{ "2200L", "not_an_xml_document" },
    .{ "2200M", "invalid_xml_document" },
    .{ "2200N", "invalid_xml_content" },
    .{ "2200S", "invalid_xml_comment" },
    .{ "2200T", "invalid_xml_processing_instruction" },
    .{ "23000", "integrity_constraint_violation" },
    .{ "23001", "restrict_violation" },
    .{ NOT_NULL_VIOLATION, "not_null_violation" },
    .{ FOREIGN_KEY_VIOLATION, "foreign_key_violation" },
    .{ UNIQUE_VIOLATION, "unique_violation" },
    .{ CHECK_VIOLATION, "check_violation" },
    .{ "23P01", "exclusion_violation" },
    .{ "24000", "invalid_cursor_state" },
    .{ "25000", "invalid_transaction_state" },
    .{ "25001", "active_sql_transaction" },
    .{ "25002", "branch_transaction_already_active" },
    .{ "25008", "held_cursor_requires_same_isolation_level" },
    .{ "25003", "inappropriate_access_mode_for_branch_transaction" },
    .{ "25004", "inappropriate_isolation_level_for_branch_transaction" },
    .{ "25005", "no_active_sql_transaction_for_branch_transaction" },
    .{ "25006", "read_only_sql_transaction" },
    .{ "25007", "schema_and_data_statement_mixing_not_supported" },
    .{ "25P01", "no_active_sql_transaction" },
    .{ "25P02", "in_failed_sql_transaction" },
    .{ "25P03", "idle_in_transaction_session_timeout" },
    .{ "26000", "invalid_sql_statement_name" },
    .{ "27000", "triggered_data_change_violation" },
    .{ "28000", "invalid_authorization_specification" },
    .{ "28P01", "invalid_password" },
    .{ "2B000", "dependent_privilege_descriptors_still_exist" },
    .{ "2BP01", "dependent_objects_still_exist" },
    .{ "2D000", "invalid_transaction_termination" },
    .{ "2F000", "sql_routine_exception" },
    .{ "2F005", "function_executed_no_return_statement" },
    .{ "2F002", "modifying_sql_data_not_permitted" },
    .{ "2F003", "prohibited_sql_statement_attempted" },
    .{ "2F004", "reading_sql_data_not_permitted" },
    .{ "34000", "invalid_cursor_name" },
    .{ "38000", "external_routine_exception" },
    .{ "38001", "containing_sql_not_permitted" },
    .{ "38002", "modifying_sql_data_not_permitted" },
    .{ "38003", "prohibited_sql_statement_attempted" },
    .{ "38004", "reading_sql_data_not_permitted" },
    .{ "39000", "external_routine_invocation_exception" },
    .{ "39001", "invalid_sqlstate_returned" },
    .{ "39004", "null_value_not_allowed" },
    .{ "39P01", "trigger_protocol_violated" },
    .{ "39P02", "srf_protocol_violated" },
    .{ "39P03", "event_trigger_protocol_violated" },
    .{ "3B000", "savepoint_exception" },
    .{ "3B001", "invalid_savepoint_specification" },
    .{ "3D000", "invalid_catalog_name" },
    .{ "3F000", "invalid_schema_name" },
    .{ "40000", "transaction_rollback" },
    .{ "40002", "transaction_integrity_constraint_violation" },
    .{ "40001", "serialization_failure" },
    .{ "40003", "statement_completion_unknown" },
    .{ "40P01", "deadlock_detected" },
    .{ "42000", "syntax_error_or_access_rule_violation" },
    .{ SYNTAX_ERROR, "syntax_error" },
    .{ "42501", "insufficient_privilege" },
    .{ "42846", "cannot_coerce" },
    .{ "42803", "grouping_error" },
    .{ "42P20", "windowing_error" },
    .{ "42P19", "invalid_recursion" },
    .{ "42830", "invalid_foreign_key" },
    .{ "42602", "invalid_name" },
    .{ "42622", "name_too_long" },
    .{ "42939", "reserved_name" },
    .{ "42804", "datatype_mismatch" },
    .{ "42P18", "indeterminate_datatype" },
    .{ "42P21", "collation_mismatch" },
    .{ "42P22", "indeterminate_collation" },
    .{ "42809", "wrong_object_type" },
    .{ "428C9", "generated_always" },
    .{ UNDEFINED_COLUMN, "undefined_column" },
    .{ "42883", "undefined_function" },
    .{ UNDEFINED_TABLE, "undefined_table" },
    .{ "42P02", "undefined_parameter" },
    .{ "42704", "undefined_object" },
    .{ "42701", "duplicate_column" },
    .{ "42P03", "duplicate_cursor" },
    .{ "42P04", "duplicate_database" },
    .{ "42723", "duplicate_function" },
    .{ "42P05", "duplicate_prepared_statement" },
    .{ "42P06", "duplicate_schema" },
    .{ "42P07", "duplicate_table" },
    .{ "42712", "duplicate_alias" },
    .{ "42710", "duplicate_object" },
    .{ "42702", "ambiguous_column" },
    .{ "42725", "ambiguous_function" },
    .{ "42P08", "ambiguous_parameter" },
    .{ "42P09", "ambiguous_alias" },
    .{ "42P10", "invalid_column_reference" },
    .{ "42611", "invalid_column_definition" },
    .{ "42P11", "invalid_cursor_definition" },
    .{ "42P12", "invalid_database_definition" },
    .{ "42P13", "invalid_function_definition" },
    .{ "42P14", "invalid_prepared_statement_definition" },
    .{ "42P15", "invalid_schema_definition" },
    .{ "42P16", "invalid_table_definition" },
    .{ "42P17", "invalid_object_definition" },
    .{ "44000", "with_check_option_violation" },
    .{ "53000", "insufficient_resources" },
    .{ "53100", "disk_full" },
    .{ "53200", "out_of_memory" },
    .{ "53300", "too_many_connections" },
    .{ "53400", "configuration_limit_exceeded" },
    .{ "54000", "program_limit_exceeded" },
    .{ "54001", "statement_too_complex" },
    .{ "54011", "too_many_columns" },
    .{ "54023", "too_many_arguments" },
    .{ "55000", "object_not_in_prerequisite_state" },
    .{ "55006", "object_in_use" },
    .{ "55P02", "cant_change_runtime_param" },
    .{ "55P03", "lock_not_available" },
    .{ "55P04", "unsafe_new_enum_value_usage" },
    .{ "57000", "operator_intervention" },
    .{ "57014", "query_canceled" },
    .{ "57P01", "admin_shutdown" },
    .{ "57P02", "crash_shutdown" },
    .{ "57P03", "cannot_connect_now" },
    .{ "57P04", "database_dropped" },
    .{ "58000", "system_error" },
    .{ "58030", "io_error" },
    .{ "58P01", "undefined_file" },
    .{ "58P02", "duplicate_file" },
    .{ "72000", "snapshot_too_old" },
    .{ "F0000", "config_file_error" },
    .{ "F0001", "lock_file_exists" },
    .{ "HV000", "fdw_error" },
    .{ "HV005", "fdw_column_name_not_found" },
    .{ "HV002", "fdw_dynamic_parameter_value_needed" },
    .{ "HV010", "fdw_function_sequence_error" },
    .{ "HV021", "fdw_inconsistent_descriptor_information" },
    .{ "HV024", "fdw_invalid_attribute_value" },
    .{ "HV007", "fdw_invalid_column_name" },
    .{ "HV008", "fdw_invalid_column_number" },
    .{ "HV004", "fdw_invalid_data_type" },
    .{ "HV006", "fdw_invalid_data_type_descriptors" },
    .{ "HV091", "fdw_invalid_descriptor_field_identifier" },
    .{ "HV00B", "fdw_invalid_handle" },
    .{ "HV00C", "fdw_invalid_option_index" },
    .{ "HV00D", "fdw_invalid_option_name" },
    .{ "HV090", "fdw_invalid_string_length_or_buffer_length" },
    .{ "HV00A", "fdw_invalid_string_format" },
    .{ "HV009", "fdw_invalid_use_of_null_pointer" },
    .{ "HV014", "fdw_too_many_handles" },
    .{ "HV001", "fdw_out_of_memory" },
    .{ "HV00P", "fdw_no_schemas" },
    .{ "HV00J", "fdw_option_name_not_found" },
    .{ "HV00K", "fdw_reply_handle" },
    .{ "HV00Q", "fdw_schema_not_found" },
    .{ "HV00R", "fdw_table_not_found" },
    .{ "HV00L", "fdw_unable_to_create_execution" },
    .{ "HV00M", "fdw_unable_to_create_reply" },
    .{ "HV00N", "fdw_unable_to_establish_connection" },
    .{ "P0000", "plpgsql_error" },
    .{ "P0001", "raise_exception" },
    .{ "P0002", "no_data_found" },
    .{ "P0003", "too_many_rows" },
    .{ "P0004", "assert_failure" },
    .{ "XX000", "internal_error" },
    .{ "XX001", "data_corrupted" },
    .{ "XX002", "index_corrupted" },
});

fn getConditionName(error_code: String) ?[]const u8 {
    if (error_code.isEmpty()) return null;
    
    const code_str = error_code.toUTF8WithoutRef(bun.default_allocator);
    defer code_str.deinit();
    
    return ERROR_CODE_MAP.get(code_str.slice());
}

const KeyValuePair = struct {
    key: []const u8,
    value: []const u8,
};

const ErrorDetailInfo = struct {
    key_value: ?KeyValuePair = null,
    column: ?[]const u8 = null,
    table: ?[]const u8 = null,
    constraint: ?[]const u8 = null,
    referenced_table: ?[]const u8 = null,
    referenced_column: ?[]const u8 = null,
    check_constraint: ?[]const u8 = null,
    violating_value: ?[]const u8 = null,
};

fn parseDetailForErrorType(error_code: String, detail: String, allocator: std.mem.Allocator) ?ErrorDetailInfo {
    if (detail.isEmpty()) return null;
    
    const detail_str = detail.toUTF8WithoutRef(allocator);
    defer detail_str.deinit();
    const detail_slice = detail_str.slice();
    
    if (error_code.eqlComptime(UNIQUE_VIOLATION)) {
        // Parse unique constraint violation: "Key (column_name)=(value) already exists."
        return parseUniqueViolationDetail(detail_slice, allocator);
    } else if (error_code.eqlComptime(FOREIGN_KEY_VIOLATION)) {
        // Parse foreign key violation: "Key (column)=(value) is not present in table "table_name"."
        return parseForeignKeyViolationDetail(detail_slice, allocator);
    } else if (error_code.eqlComptime(NOT_NULL_VIOLATION)) {
        // Parse not null violation: "null value in column "column_name" violates not-null constraint"
        return parseNotNullViolationDetail(detail_slice, allocator);
    } else if (error_code.eqlComptime(CHECK_VIOLATION)) {
        // Parse check constraint violation: 'new row for relation "table" violates check constraint "constraint_name"'
        return parseCheckViolationDetail(detail_slice, allocator);
    }
    
    return null;
}

fn parseUniqueViolationDetail(detail_slice: []const u8, allocator: std.mem.Allocator) ?ErrorDetailInfo {
    // Parse format: "Key (column_name)=(value) already exists."
    if (std.mem.indexOf(u8, detail_slice, "Key (")) |start| {
        const after_key = start + 5; // "Key (".len
        if (std.mem.indexOf(u8, detail_slice[after_key..], ")=(")) |end_key_relative| {
            const end_key = after_key + end_key_relative;
            const key = detail_slice[after_key..end_key];
            
            const value_start = end_key + 3; // ")=(".len
            if (std.mem.indexOf(u8, detail_slice[value_start..], ") ")) |end_value_relative| {
                const end_value = value_start + end_value_relative;
                const value = detail_slice[value_start..end_value];
                
                // Allocate and copy the strings
                const key_copy = allocator.dupe(u8, key) catch return null;
                const value_copy = allocator.dupe(u8, value) catch {
                    allocator.free(key_copy);
                    return null;
                };
                
                return ErrorDetailInfo{
                    .key_value = KeyValuePair{ .key = key_copy, .value = value_copy },
                };
            }
        }
    }
    return null;
}

fn parseForeignKeyViolationDetail(detail_slice: []const u8, allocator: std.mem.Allocator) ?ErrorDetailInfo {
    var result = ErrorDetailInfo{};
    
    // Parse format: "Key (column)=(value) is not present in table "table_name"."
    if (std.mem.indexOf(u8, detail_slice, "Key (")) |start| {
        const after_key = start + 5; // "Key (".len
        if (std.mem.indexOf(u8, detail_slice[after_key..], ")=(")) |end_key_relative| {
            const end_key = after_key + end_key_relative;
            const key = detail_slice[after_key..end_key];
            
            const value_start = end_key + 3; // ")=(".len
            if (std.mem.indexOf(u8, detail_slice[value_start..], ") ")) |end_value_relative| {
                const end_value = value_start + end_value_relative;
                const value = detail_slice[value_start..end_value];
                
                // Allocate key/value
                const key_copy = allocator.dupe(u8, key) catch return null;
                const value_copy = allocator.dupe(u8, value) catch {
                    allocator.free(key_copy);
                    return null;
                };
                result.key_value = KeyValuePair{ .key = key_copy, .value = value_copy };
            }
        }
    }
    
    // Parse referenced table: 'in table "table_name"'
    if (std.mem.indexOf(u8, detail_slice, "in table \"")) |table_start| {
        const table_name_start = table_start + 10; // "in table \"".len
        if (std.mem.indexOf(u8, detail_slice[table_name_start..], "\"")) |table_end_relative| {
            const table_end = table_name_start + table_end_relative;
            const table_name = detail_slice[table_name_start..table_end];
            result.referenced_table = allocator.dupe(u8, table_name) catch return result;
        }
    }
    
    return result;
}

fn parseNotNullViolationDetail(detail_slice: []const u8, allocator: std.mem.Allocator) ?ErrorDetailInfo {
    // Parse format: "null value in column "column_name" violates not-null constraint"
    if (std.mem.indexOf(u8, detail_slice, "null value in column \"")) |start| {
        const column_start = start + 22; // "null value in column \"".len
        if (std.mem.indexOf(u8, detail_slice[column_start..], "\"")) |column_end_relative| {
            const column_end = column_start + column_end_relative;
            const column_name = detail_slice[column_start..column_end];
            
            const column_copy = allocator.dupe(u8, column_name) catch return null;
            return ErrorDetailInfo{
                .column = column_copy,
            };
        }
    }
    return null;
}

fn parseCheckViolationDetail(detail_slice: []const u8, allocator: std.mem.Allocator) ?ErrorDetailInfo {
    var result = ErrorDetailInfo{};
    
    // Parse format: 'new row for relation "table_name" violates check constraint "constraint_name"'
    if (std.mem.indexOf(u8, detail_slice, "violates check constraint \"")) |constraint_start| {
        const constraint_name_start = constraint_start + 27; // "violates check constraint \"".len
        if (std.mem.indexOf(u8, detail_slice[constraint_name_start..], "\"")) |constraint_end_relative| {
            const constraint_end = constraint_name_start + constraint_end_relative;
            const constraint_name = detail_slice[constraint_name_start..constraint_end];
            result.check_constraint = allocator.dupe(u8, constraint_name) catch return result;
        }
    }
    
    // Parse table name: 'new row for relation "table_name"'
    if (std.mem.indexOf(u8, detail_slice, "new row for relation \"")) |table_start| {
        const table_name_start = table_start + 22; // "new row for relation \"".len
        if (std.mem.indexOf(u8, detail_slice[table_name_start..], "\"")) |table_end_relative| {
            const table_end = table_name_start + table_end_relative;
            const table_name = detail_slice[table_name_start..table_end];
            result.table = allocator.dupe(u8, table_name) catch return result;
        }
    }
    
    return result;
}

fn deinitErrorDetailInfo(info: ErrorDetailInfo, allocator: std.mem.Allocator) void {
    if (info.key_value) |kv| {
        allocator.free(kv.key);
        allocator.free(kv.value);
    }
    if (info.column) |col| allocator.free(col);
    if (info.table) |tbl| allocator.free(tbl);
    if (info.constraint) |cst| allocator.free(cst);
    if (info.referenced_table) |ref_tbl| allocator.free(ref_tbl);
    if (info.referenced_column) |ref_col| allocator.free(ref_col);
    if (info.check_constraint) |check_cst| allocator.free(check_cst);
    if (info.violating_value) |val| allocator.free(val);
}

pub fn toJS(this: ErrorResponse, globalObject: *jsc.JSGlobalObject) JSValue {
    var b = bun.StringBuilder{};
    defer b.deinit(bun.default_allocator);

    // Pre-calculate capacity to avoid reallocations
    for (this.messages.items) |*msg| {
        b.cap += switch (msg.*) {
            inline else => |m| m.utf8ByteLength(),
        } + 1;
    }
    b.allocate(bun.default_allocator) catch {};

    // Build a more structured error message
    var severity: String = String.dead;
    var code: String = String.dead;
    var message: String = String.dead;
    var detail: String = String.dead;
    var hint: String = String.dead;
    var position: String = String.dead;
    var where: String = String.dead;
    var schema: String = String.dead;
    var table: String = String.dead;
    var column: String = String.dead;
    var datatype: String = String.dead;
    var constraint: String = String.dead;
    var file: String = String.dead;
    var line: String = String.dead;
    var routine: String = String.dead;

    for (this.messages.items) |*msg| {
        switch (msg.*) {
            .severity => |str| severity = str,
            .code => |str| code = str,
            .message => |str| message = str,
            .detail => |str| detail = str,
            .hint => |str| hint = str,
            .position => |str| position = str,
            .where => |str| where = str,
            .schema => |str| schema = str,
            .table => |str| table = str,
            .column => |str| column = str,
            .datatype => |str| datatype = str,
            .constraint => |str| constraint = str,
            .file => |str| file = str,
            .line => |str| line = str,
            .routine => |str| routine = str,
            else => {},
        }
    }

    var needs_newline = false;
    construct_message: {
        if (!message.isEmpty()) {
            _ = b.appendStr(message);
            needs_newline = true;
            break :construct_message;
        }
        if (!detail.isEmpty()) {
            if (needs_newline) {
                _ = b.append("\n");
            } else {
                _ = b.append(" ");
            }
            needs_newline = true;
            _ = b.appendStr(detail);
        }
        if (!hint.isEmpty()) {
            if (needs_newline) {
                _ = b.append("\n");
            } else {
                _ = b.append(" ");
            }
            needs_newline = true;
            _ = b.appendStr(hint);
        }
    }

    // Parse detailed error information from various PostgreSQL error types
    var error_detail_info: ?ErrorDetailInfo = null;
    defer if (error_detail_info) |info| {
        deinitErrorDetailInfo(info, bun.default_allocator);
    };
    
    if (!code.isEmpty() and !detail.isEmpty()) {
        error_detail_info = parseDetailForErrorType(code, detail, bun.default_allocator);
    }

    const possible_fields = .{
        .{ "detail", detail, void },
        .{ "hint", hint, void },
        .{ "column", column, void },
        .{ "constraint", constraint, void },
        .{ "datatype", datatype, void },
        // in the past this was set to i32 but postgres returns a strings lets keep it compatible
        .{ "errno", code, void },
        .{ "position", position, i32 },
        .{ "schema", schema, void },
        .{ "table", table, void },
        .{ "where", where, void },
    };
    const error_code: jsc.Error =
        // https://www.postgresql.org/docs/8.1/errcodes-appendix.html
        if (code.eqlComptime(SYNTAX_ERROR))
            .POSTGRES_SYNTAX_ERROR
        else
            .POSTGRES_SERVER_ERROR;
    const err = error_code.fmt(globalObject, "{s}", .{b.allocatedSlice()[0..b.len]});

    inline for (possible_fields) |field| {
        if (!field.@"1".isEmpty()) {
            const value = brk: {
                if (field.@"2" == i32) {
                    if (field.@"1".toInt32()) |val| {
                        break :brk jsc.JSValue.jsNumberFromInt32(val);
                    }
                }

                break :brk field.@"1".toJS(globalObject);
            };

            err.put(globalObject, jsc.ZigString.static(field.@"0"), value);
        }
    }

    // Add condition name if we have an error code
    if (!code.isEmpty()) {
        if (getConditionName(code)) |condition_name| {
            err.put(globalObject, jsc.ZigString.static("condition"), jsc.ZigString.init(condition_name).toJS(globalObject));
        }
    }

    // Add parsed detail information fields
    if (error_detail_info) |info| {
        // Add key and value fields (for unique/foreign key violations)
        if (info.key_value) |kv| {
            err.put(globalObject, jsc.ZigString.static("key"), jsc.ZigString.init(kv.key).toJS(globalObject));
            err.put(globalObject, jsc.ZigString.static("value"), jsc.ZigString.init(kv.value).toJS(globalObject));
        }
        
        // Add column field (for not null violations, etc.)
        if (info.column) |col| {
            err.put(globalObject, jsc.ZigString.static("failing_column"), jsc.ZigString.init(col).toJS(globalObject));
        }
        
        // Add referenced table field (for foreign key violations)
        if (info.referenced_table) |ref_tbl| {
            err.put(globalObject, jsc.ZigString.static("referenced_table"), jsc.ZigString.init(ref_tbl).toJS(globalObject));
        }
        
        // Add other parsed fields as needed
        if (info.table) |tbl| {
            err.put(globalObject, jsc.ZigString.static("failing_table"), jsc.ZigString.init(tbl).toJS(globalObject));
        }
        
        if (info.constraint) |cst| {
            err.put(globalObject, jsc.ZigString.static("failing_constraint"), jsc.ZigString.init(cst).toJS(globalObject));
        }
        
        if (info.referenced_column) |ref_col| {
            err.put(globalObject, jsc.ZigString.static("referenced_column"), jsc.ZigString.init(ref_col).toJS(globalObject));
        }
        
        // Add check constraint specific fields
        if (info.check_constraint) |check_cst| {
            err.put(globalObject, jsc.ZigString.static("check_constraint"), jsc.ZigString.init(check_cst).toJS(globalObject));
        }
        
        if (info.violating_value) |val| {
            err.put(globalObject, jsc.ZigString.static("violating_value"), jsc.ZigString.init(val).toJS(globalObject));
        }
    }

    return err;
}

const std = @import("std");
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const FieldMessage = @import("./FieldMessage.zig").FieldMessage;
const NewReader = @import("./NewReader.zig").NewReader;

const bun = @import("bun");
const String = bun.String;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
