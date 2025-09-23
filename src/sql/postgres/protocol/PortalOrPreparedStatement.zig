pub const PortalOrPreparedStatement = union(enum) {
    portal: []const u8,
    prepared_statement: []const u8,

    pub fn slice(this: @This()) []const u8 {
        return switch (this) {
            .portal => this.portal,
            .prepared_statement => this.prepared_statement,
        };
    }

    pub fn tag(this: @This()) u8 {
        return switch (this) {
            .portal => 'P',
            .prepared_statement => 'S',
        };
    }
};
