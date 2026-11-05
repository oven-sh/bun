#[path = "../statistics/limit_values.rs"]
pub mod limit_values;

pub use self::limit_values::{HOST_ARCHITECTURE, LimitValues, limit_of_queries};
use crate::Opaque;
pub use crate::ir::generated::{Architecture, LimitId, Stage, StatisticId};
use crate::linked;
pub use crate::linked::{
    bun_aot_log_part_outside_stages as log_part_outside_stages,
    bun_aot_log_time_outside_stages as log_time_outside_stages,
};

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
