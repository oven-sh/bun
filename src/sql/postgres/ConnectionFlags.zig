// @sortImports
pub const ConnectionFlags = packed struct {
    is_ready_for_query: bool = false,
    is_processing_data: bool = false,
    use_unnamed_prepared_statements: bool = false,
};
