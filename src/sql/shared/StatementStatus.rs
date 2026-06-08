#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Status {
    Pending,
    Parsing,
    Prepared,
    Failed,
}

impl Status {
    pub fn is_running(self) -> bool {
        self == Status::Parsing
    }
}
