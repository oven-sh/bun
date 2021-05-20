pub const Runtime = struct {
    pub const Features = packed struct {
        react_fast_refresh: bool = false,
        hot_module_reloading: bool = false,
        keep_names_for_arrow_functions: bool = true,
    };

    pub const Functions = enum {
        KeepNames,
        CommonJSToESModule,
        TypeScriptDecorateClass,
        TypeScriptDecorateParam,
    };
};
