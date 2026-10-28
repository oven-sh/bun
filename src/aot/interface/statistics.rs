#[path = "../statistics/limit_values.rs"]
pub mod limit_values;

pub use self::limit_values::{HOST_ARCHITECTURE, LimitValues, can_be_lowered, fails_build};
use crate::Opaque;
pub use crate::ir::generated::{Architecture, DegradesTo, LimitId, Stage, StatisticId};
use crate::linked;

pub struct Statistics(pub Opaque);

impl Default for Statistics {
    fn default() -> Statistics {
        linked::bun_aot_new_statistics()
    }
}

impl Statistics {
    pub fn get(&self, id: StatisticId) -> u64 {
        linked::bun_aot_statistic(self, id)
    }
}
