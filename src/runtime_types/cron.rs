#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CronRegisterState {
    ReadingCrontab,
    InstallingCrontab,
    WritingPlist,
    BootingOut,
    Bootstrapping,
    Done,
    Failed,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CronRemoveState {
    ReadingCrontab,
    InstallingCrontab,
    BootingOut,
    Done,
    Failed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cron_states_keep_zig_tag_shape() {
        assert_eq!(core::mem::size_of::<CronRegisterState>(), 1);
        assert_eq!(core::mem::size_of::<CronRemoveState>(), 1);
        assert_ne!(
            CronRegisterState::ReadingCrontab,
            CronRegisterState::InstallingCrontab
        );
        assert_ne!(
            CronRemoveState::ReadingCrontab,
            CronRemoveState::InstallingCrontab
        );
    }
}
