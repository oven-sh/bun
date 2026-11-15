use bun_ast::JsonView;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ConfigVersion {
    V0 = 0,
    V1 = 1,
}

impl ConfigVersion {
    pub(crate) const CURRENT: ConfigVersion = ConfigVersion::V1;

    pub(crate) fn from_json(expr: JsonView<'_, '_>) -> Option<ConfigVersion> {
        let version: f64 = expr.as_number()?;

        if version == 0.0 {
            return Some(ConfigVersion::V0);
        } else if version == 1.0 {
            return Some(ConfigVersion::V1);
        }

        if version.trunc() != version {
            return None;
        }

        if version > (Self::CURRENT as u8) as f64 {
            return Some(Self::CURRENT);
        }

        None
    }

    pub(crate) fn from_int(int: u64) -> Option<ConfigVersion> {
        match int {
            0 => Some(ConfigVersion::V0),
            1 => Some(ConfigVersion::V1),
            _ => {
                if int > Self::CURRENT as u64 {
                    return Some(Self::CURRENT);
                }

                None
            }
        }
    }
}
