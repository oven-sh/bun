/// libpq's `channel_binding` connection parameter.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum ChannelBinding {
    Disable = 0,
    #[default]
    Prefer = 1,
    Require = 2,
}

impl ChannelBinding {
    pub fn from_int(value: i32) -> Self {
        match value {
            0 => Self::Disable,
            2 => Self::Require,
            _ => Self::Prefer,
        }
    }
}
