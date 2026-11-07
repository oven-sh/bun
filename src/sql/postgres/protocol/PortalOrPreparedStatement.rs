pub enum PortalOrPreparedStatement<'a> {
    Portal(&'a [u8]),
    PreparedStatement(&'a [u8]),
}

impl<'a> PortalOrPreparedStatement<'a> {
    pub(crate) fn slice(&self) -> &'a [u8] {
        match self {
            PortalOrPreparedStatement::Portal(s) => s,
            PortalOrPreparedStatement::PreparedStatement(s) => s,
        }
    }

    pub(crate) fn tag(&self) -> u8 {
        match self {
            PortalOrPreparedStatement::Portal(_) => b'P',
            PortalOrPreparedStatement::PreparedStatement(_) => b'S',
        }
    }
}
