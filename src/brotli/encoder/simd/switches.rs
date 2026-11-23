use bun_simd::prelude::*;

targets!(Upto<B32>);

#[simd]
struct Step {
    min_cost: f64x8<S>,
    max_cost: f64x8<S>,
    smallest: f64x4<S>,
}

#[simd]
impl Step<S> {
    /// Returns `zeros`, with a bit for each histogram that was the cheapest shifted in at the top.
    fn add(
        &mut self,
        costs: &mut [f64; 8],
        added: &[f64; 8],
        switches: &mut u8,
        zeros: u64,
    ) -> u64 {
        let relative = f64x8::from(*costs) - self.min_cost;
        let next = relative.simd_min_relaxed(self.max_cost) + *added;
        let [lower, upper] = next.split();
        self.smallest = (lower.simd_min_relaxed(upper)).simd_min_relaxed(self.smallest);
        *costs = next.into();
        *switches = relative.simd_ge(self.max_cost).to_bitmask() as u8;
        zeros >> 8 | relative.simd_eq(0.0).to_bitmask() << 56
    }

    /// For up to 8 groups.
    fn add_all(&mut self, costs: &mut [[f64; 8]], added: &[[f64; 8]], switches: &mut [u8]) -> u64 {
        let (mut groups, mut zeros) = (costs.iter_mut().zip(added).zip(switches), 0);
        if Native::<S>::BYTES >= 32 {
            unroll!(for _nth in 0..8 {
                let Some(((costs, added), switches)) = groups.next() else {
                    return zeros;
                };
                zeros = self.add(costs, added, switches, zeros);
            });
        }
        for ((costs, added), switches) in groups {
            zeros = self.add(costs, added, switches, zeros);
        }
        zeros
    }
}

/// Adds up what `symbols` cost in each histogram, where one can take over the sum of the cheapest for `switch_cost`.
#[kernel]
#[inline(never)]
pub(crate) fn find_switches(
    symbols: &[u16],
    // For each symbol of the alphabet, as many as there are `costs`.
    symbol_costs: &[[f64; 8]],
    switch_cost: f64,
    // The sums, for groups of histograms.
    costs: &mut [[f64; 8]],
    // For each symbol and group, a bit for each histogram that takes over before the symbol.
    switches: &mut [u8],
    // For each symbol, the first of the cheapest histograms after it.
    cheapest: &mut [u8],
) {
    const PROLOGUE: usize = 2000;
    const TOO_MUCH: f64 = 1e99;
    let groups = costs.len();
    assert!((1..=16).contains(&groups) && groups <= symbol_costs.len());
    assert!(symbols.len() <= cheapest.len().min(switches.len() / groups));
    let last_symbol = symbol_costs.len() / groups - 1;
    let low_groups = groups.min(8);
    let (mut min_cost, mut max_cost) = (f64x4::zero(), TOO_MUCH);
    let mut previous_cheapest = &mut 0;
    let rows = (symbols.iter().zip(switches.chunks_exact_mut(groups))).zip(cheapest);
    for (position, ((&symbol, switches), cheapest)) in rows.enumerate() {
        let added = &symbol_costs[last_symbol.min(symbol.into()) * groups..][..groups];
        // Finishes the previous symbol, which had to wait for `min_cost`.
        let mut step = Step {
            min_cost: f64x8::from_halves([min_cost; 2]),
            max_cost: f64x8::splat(max_cost),
            smallest: f64x4::splat(TOO_MUCH),
        };
        let (low_costs, high_costs) = costs.split_at_mut(low_groups);
        let (low_switches, high_switches) = switches.split_at_mut(low_groups);
        let (low_added, high_added) = added.split_at(low_groups);
        let low = step.add_all(low_costs, low_added, low_switches);
        let high = step.add_all(high_costs, high_added, high_switches);
        *previous_cheapest = match low {
            0 => (64 + (high | 1 << 63).trailing_zeros() as usize).wrapping_sub(8 * (16 - groups)),
            _ => (low.trailing_zeros() as usize).wrapping_sub(8 * (8 - low_groups)),
        } as u8;
        previous_cheapest = cheapest;
        min_cost = (step.smallest).simd_min_relaxed(step.smallest.rotate_elements_left::<2>());
        min_cost = min_cost.simd_min_relaxed(min_cost.swap_pairs());
        max_cost = switch_cost;
        if position < PROLOGUE {
            max_cost *= 0.77 + (0.07 / PROLOGUE as f64) * position as f64;
        }
    }
    let costs = costs.as_flattened();
    let last = costs.iter().position(|&cost| cost == min_cost[0]);
    *previous_cheapest = last.unwrap_or(costs.len() - 1) as u8;
}
