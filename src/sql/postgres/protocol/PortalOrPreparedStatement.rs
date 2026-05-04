pub enum PortalOrPreparedStatement<'a> {
    Portal(&'a [u8]),
    PreparedStatement(&'a [u8]),
}

impl<'a> PortalOrPreparedStatement<'a> {
    pub fn slice(&self) -> &'a [u8] {
        match self {
            PortalOrPreparedStatement::Portal(s) => s,
            PortalOrPreparedStatement::PreparedStatement(s) => s,
        }
    }

    pub fn tag(&self) -> u8 {
        match self {
            PortalOrPreparedStatement::Portal(_) => b'P',
            PortalOrPreparedStatement::PreparedStatement(_) => b'S',
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/PortalOrPreparedStatement.zig (18 lines)
//   confidence: high
//   todos:      0
//   notes:      borrowed-slice payload; enum carries <'a> (transient param wrapper, no deinit)
// ──────────────────────────────────────────────────────────────────────────
