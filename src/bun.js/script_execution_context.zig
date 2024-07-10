const JSC = bun.JSC;

pub const ScriptExecutionContext = extern struct {
    main_file_path: JSC.ZigString,
    is_macro: bool = false,
    js_global_object: bool = false,
};
