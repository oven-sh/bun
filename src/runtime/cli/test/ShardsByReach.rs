//! `bun test --aot --shard=<index>/<count>`: which test files go together.
//!
//! A compiled run builds what its test files reach before the first of them runs. Dealt by their names or by their times alone,
//! the files that reach a part of the project are spread over all shards, and every shard builds nearly all of it: the tests are
//! divided by the number of shards and the build by nothing. So the files that reach the same go into the same shard.
//!
//! Every machine deals for itself, so the deal hangs on what all of them have alike and on nothing else: the files, their sizes and
//! the table of recorded times. Not on the machine, and not on a flag that may be written otherwise from one to the next, as
//! `--parallel` is. Whole numbers, and where two are equal the file that comes first.

/// What the test files of all shards reach.
pub(crate) struct Reach<'a> {
    /// The test files are the first of the files, in the order of their paths.
    pub(crate) test_count: usize,
    /// Of each file, the files that it imports.
    pub(crate) imports: &'a [Vec<u32>],
    /// Of each file, its bytes of source.
    pub(crate) sizes: &'a [u64],
    /// What runs in front of every test file.
    pub(crate) preloads: &'a [u32],
}

/// What a shard takes, in one unit.
pub(crate) struct Costs<'a> {
    /// Of each test file, to run it. Not 0.
    pub(crate) of_run: &'a [u64],
    /// To build a thousand bytes of source. 0: nobody knows how it compares with a run, and the shards are made equal by their runs.
    pub(crate) of_thousand_bytes: u64,
    /// How many test files run at once. A shard is not through before its longest file is, whatever runs beside that. 0: nobody knows.
    pub(crate) at_once: u64,
    /// Of each test file, the megabytes that it takes where the run holds it back for them, else 0: see `end_of_heavy_files`.
    pub(crate) of_heavy: &'a [u32],
}

/// The test files of a shard.
#[derive(Copy, Clone, Default)]
struct Run {
    /// What they cost together.
    sum: u64,
    /// What the one that costs most costs.
    longest: u64,
    /// `end_of_heavy_files`.
    heavy_end: u64,
}

/// A test file that the run holds back for the memory that it takes: what it costs, and its megabytes.
type HeavyFile = (u64, u32);

/// When the last of the heavy files of a shard ends, if the first begin with the run. A run has room for its heaviest file, and a
/// heavy file waits while it and those that run would take more: `Parts::is_held_back`. They go slowest first, and one that has
/// room goes ahead of one that waits.
fn end_of_heavy_files(files: &[HeavyFile]) -> u64 {
    let megabytes = files.iter().map(|file| u64::from(file.1));
    let room = megabytes.max().unwrap_or(0);
    let mut waiting = files.to_vec();
    waiting.sort_unstable_by(|a, b| b.cmp(a));
    // When each ends, and its megabytes.
    let mut running: Vec<HeavyFile> = Vec::new();
    let (mut now, mut taken, mut last) = (0u64, 0u64, 0u64);
    loop {
        waiting.retain(|&(cost, megabytes)| {
            if taken != 0 && taken + u64::from(megabytes) > room {
                return true;
            }
            taken += u64::from(megabytes);
            running.push((now + cost, megabytes));
            last = last.max(now + cost);
            false
        });
        let first_to_end = (0..running.len()).min_by_key(|&at| running[at]);
        let Some(at) = first_to_end.filter(|_| !waiting.is_empty()) else {
            return last;
        };
        let (end, megabytes) = running.swap_remove(at);
        now = end;
        taken -= u64::from(megabytes);
    }
}

pub(crate) struct Deal {
    /// Of each test file.
    pub(crate) shard_of: Vec<u32>,
    /// What the shard that takes longest takes.
    pub(crate) longest: u64,
    /// Of each shard, the bytes of source that it builds.
    pub(crate) bytes_of: Vec<u64>,
}

struct Tails {
    /// What every shard builds: what the preloads reach.
    core_bytes: u64,
    /// Of each test file, what it reaches beyond that. Other test files are no part of it, what they import is.
    of_test: Vec<Vec<u32>>,
    bytes_of_test: Vec<u64>,
    /// Of each file, the test files in whose tail it is.
    tests_of: Vec<Vec<u32>>,
    /// A test file with fewer bytes in its tail costs nearly the same wherever it goes.
    light_below: u64,
}

impl Tails {
    fn find(reach: &Reach<'_>) -> Tails {
        let (count, tests) = (reach.imports.len(), reach.test_count);
        let mut is_in_core = vec![false; count];
        let mut to_visit: Vec<u32> = Vec::new();
        for &preload in reach.preloads {
            if !core::mem::replace(&mut is_in_core[preload as usize], true) {
                to_visit.push(preload);
            }
        }
        while let Some(file) = to_visit.pop() {
            for &imported in &reach.imports[file as usize] {
                let at = imported as usize;
                if at >= tests && !core::mem::replace(&mut is_in_core[at], true) {
                    to_visit.push(imported);
                }
            }
        }
        let bytes_where = |is_counted: &dyn Fn(usize) -> bool| -> u64 {
            (tests..count)
                .filter(|&file| is_counted(file))
                .map(|file| reach.sizes[file])
                .sum()
        };
        let core_bytes = bytes_where(&|file| is_in_core[file]);

        const NOBODY: u32 = u32::MAX;
        let mut seen_by = vec![NOBODY; count];
        let mut of_test: Vec<Vec<u32>> = Vec::with_capacity(tests);
        let mut tests_of: Vec<Vec<u32>> = vec![Vec::new(); count];
        for test in 0..tests as u32 {
            let mut tail = Vec::new();
            seen_by[test as usize] = test;
            to_visit.push(test);
            while let Some(file) = to_visit.pop() {
                for &imported in &reach.imports[file as usize] {
                    let at = imported as usize;
                    if is_in_core[at] || core::mem::replace(&mut seen_by[at], test) == test {
                        continue;
                    }
                    to_visit.push(imported);
                    if at >= tests {
                        tail.push(imported);
                        tests_of[at].push(test);
                    }
                }
            }
            of_test.push(tail);
        }
        let bytes_of_test: Vec<u64> = (of_test.iter())
            .map(|tail| tail.iter().map(|&file| reach.sizes[file as usize]).sum())
            .collect();
        let beyond_core = bytes_where(&|file| !tests_of[file].is_empty());
        Tails {
            core_bytes,
            of_test,
            bytes_of_test,
            tests_of,
            light_below: (core_bytes + beyond_core) / 2000,
        }
    }
}

struct Dealer<'a> {
    reach: &'a Reach<'a>,
    costs: &'a Costs<'a>,
    tails: Tails,
    shard_count: usize,
}

impl Dealer<'_> {
    fn cost(&self, bytes: u64, run: Run) -> u64 {
        // What takes its time whatever runs beside it.
        let alone = run.longest.max(run.heavy_end);
        (bytes / 1000)
            .saturating_mul(self.costs.of_thousand_bytes)
            .saturating_add(run.sum.max(alone.saturating_mul(self.costs.at_once)))
    }

    /// `run`, whose heavy files are `heavy`, with one test file more.
    fn with(&self, run: Run, heavy: &[HeavyFile], test: usize) -> Run {
        let (cost, megabytes) = (self.costs.of_run[test], self.costs.of_heavy[test]);
        Run {
            sum: run.sum + cost,
            longest: run.longest.max(cost),
            heavy_end: match megabytes {
                0 => run.heavy_end,
                _ => end_of_heavy_files(&[heavy, &[(cost, megabytes)]].concat()),
            },
        }
    }

    fn weigh(&self, shard_of: Vec<u32>) -> Deal {
        let mut bytes_of = vec![self.tails.core_bytes; self.shard_count];
        let mut run_of = vec![Run::default(); self.shard_count];
        let mut heavy_of: Vec<Vec<HeavyFile>> = vec![Vec::new(); self.shard_count];
        let mut is_empty = vec![true; self.shard_count];
        let mut has = vec![false; self.reach.imports.len() * self.shard_count];
        for (test, &shard) in shard_of.iter().enumerate() {
            let shard = shard as usize;
            is_empty[shard] = false;
            run_of[shard] = self.with(run_of[shard], &heavy_of[shard], test);
            if self.costs.of_heavy[test] != 0 {
                heavy_of[shard].push((self.costs.of_run[test], self.costs.of_heavy[test]));
            }
            for &file in &self.tails.of_test[test] {
                let at = shard * self.reach.imports.len() + file as usize;
                if !core::mem::replace(&mut has[at], true) {
                    bytes_of[shard] += self.reach.sizes[file as usize];
                }
            }
        }
        // A shard without a test file builds nothing.
        for (bytes, _) in bytes_of.iter_mut().zip(is_empty).filter(|it| it.1) {
            *bytes = 0;
        }
        let costs = bytes_of.iter().zip(&run_of);
        let longest = costs.map(|(&bytes, &run)| self.cost(bytes, run)).max();
        Deal {
            shard_of,
            longest: longest.unwrap_or(0),
            bytes_of,
        }
    }

    /// A deal in which no shard takes more than `limit`, if this way of dealing finds one.
    ///
    /// A shard at a time: first the test file with the largest tail that is left, then always the one that adds least for what it
    /// would cost elsewhere, as long as the shard has room. One that is too long by itself behind what this shard builds, or would
    /// wait too long for the heavy files that the shard has, is left for another shard. The light files go in last, each where it
    /// adds least.
    fn deal_within(&self, limit: u64) -> Option<Vec<u32>> {
        const NO_SHARD: u32 = u32::MAX;
        let (tails, sizes) = (&self.tails, self.reach.sizes);
        let tests = self.reach.test_count;
        let is_heavy = |test: usize| tails.bytes_of_test[test] >= tails.light_below.max(1);
        let mut shard_of = vec![NO_SHARD; tests];
        let mut heavy_left: Vec<u32> = (0..tests as u32)
            .filter(|&test| is_heavy(test as usize))
            .collect();
        let mut has_of: Vec<Vec<bool>> = Vec::with_capacity(self.shard_count);
        let mut bytes_of = vec![tails.core_bytes; self.shard_count];
        let mut run_of = vec![Run::default(); self.shard_count];
        let mut heavy_of: Vec<Vec<HeavyFile>> = vec![Vec::new(); self.shard_count];
        for shard in 0..self.shard_count {
            let mut has = vec![false; sizes.len()];
            // Of each test file, the bytes that it would add to this shard.
            let mut adds = match heavy_left.is_empty() {
                true => Vec::new(),
                false => tails.bytes_of_test.clone(),
            };
            let mut is_first = true;
            let mut too_long_here: Vec<u32> = Vec::new();
            loop {
                let key = |&(_, &test): &(usize, &u32)| -> (i64, u32) {
                    let whole = tails.bytes_of_test[test as usize] as i64;
                    match is_first {
                        true => (-whole, test),
                        false => (10 * adds[test as usize] as i64 - 3 * whole, test),
                    }
                };
                let Some((at, &best)) = heavy_left.iter().enumerate().min_by_key(key) else {
                    break;
                };
                let best = best as usize;
                let run = self.with(run_of[shard], &heavy_of[shard], best);
                let bytes = bytes_of[shard] + adds[best];
                if self.cost(bytes, run) > limit {
                    let by_its_sum = Run {
                        sum: run.sum,
                        ..run_of[shard]
                    };
                    if self.cost(bytes, by_its_sum) <= limit {
                        too_long_here.push(heavy_left.swap_remove(at));
                        continue;
                    }
                    if is_first {
                        return None;
                    }
                    break;
                }
                is_first = false;
                heavy_left.swap_remove(at);
                shard_of[best] = shard as u32;
                run_of[shard] = run;
                if self.costs.of_heavy[best] != 0 {
                    heavy_of[shard].push((self.costs.of_run[best], self.costs.of_heavy[best]));
                }
                for &file in &tails.of_test[best] {
                    let at = file as usize;
                    if core::mem::replace(&mut has[at], true) {
                        continue;
                    }
                    bytes_of[shard] += sizes[at];
                    for &test in &tails.tests_of[at] {
                        adds[test as usize] -= sizes[at];
                    }
                }
            }
            heavy_left.append(&mut too_long_here);
            has_of.push(has);
        }
        if !heavy_left.is_empty() {
            return None;
        }
        let mut light: Vec<usize> = (0..tests)
            .filter(|&test| shard_of[test] == NO_SHARD)
            .collect();
        light.sort_by_key(|&test| {
            let (bytes, run) = (tails.bytes_of_test[test], self.costs.of_run[test]);
            (u64::MAX - bytes, u64::MAX - run, test)
        });
        for test in light {
            let added_to = |shard: usize| -> u64 {
                (tails.of_test[test].iter())
                    .filter(|&&file| !has_of[shard][file as usize])
                    .map(|&file| sizes[file as usize])
                    .sum()
            };
            let best = (0..self.shard_count)
                .map(|shard| {
                    let added = added_to(shard);
                    let run = self.with(run_of[shard], &heavy_of[shard], test);
                    (added, self.cost(bytes_of[shard] + added, run), shard)
                })
                .filter(|&(_, cost, _)| cost <= limit)
                .min()?;
            let (added, _, shard) = best;
            shard_of[test] = shard as u32;
            bytes_of[shard] += added;
            run_of[shard] = self.with(run_of[shard], &heavy_of[shard], test);
            if self.costs.of_heavy[test] != 0 {
                heavy_of[shard].push((self.costs.of_run[test], self.costs.of_heavy[test]));
            }
            for &file in &tails.of_test[test] {
                has_of[shard][file as usize] = true;
            }
        }
        Some(shard_of)
    }
}

/// `otherwise`: the shard of each test file as `--shard` deals without `--aot`. The deal is that one unless another is shorter.
pub(crate) fn deal(
    reach: &Reach<'_>,
    costs: &Costs<'_>,
    shard_count: usize,
    otherwise: Vec<u32>,
) -> Deal {
    let dealer = Dealer {
        reach,
        costs,
        tails: Tails::find(reach),
        shard_count,
    };
    let mut best = dealer.weigh(otherwise);
    // Shorter, or as long and with less to build in all.
    let keep_if_better = |best: &mut Deal, found: Deal| {
        let key = |deal: &Deal| (deal.longest, deal.bytes_of.iter().sum::<u64>());
        if key(&found) < key(best) {
            *best = found;
        }
    };
    // No deal is shorter than the core's build with an equal share of the runs, or with the longest file.
    let least = Run {
        sum: costs.of_run.iter().sum::<u64>() / shard_count as u64,
        longest: costs.of_run.iter().copied().max().unwrap_or(0),
        heavy_end: 0,
    };
    let shortest = dealer.cost(dealer.tails.core_bytes, least);
    let mut too_short = shortest.saturating_sub(1);
    let mut reached = best.longest;
    // So many limits are tried at once, each by itself, and the lowest that has a deal counts: which thread is through first has
    // no say. The first time, the length of the other deal is among them: a deal as long with less to build is the better one.
    const LIMITS_AT_ONCE: u64 = 15;
    let mut tries_what_is_reached = true;
    while tries_what_is_reached || reached.saturating_sub(too_short) > 1 + reached / 256 {
        let step = (reached.saturating_sub(too_short) / (LIMITS_AT_ONCE + 1)).max(1);
        let mut limits: Vec<u64> = (1..=LIMITS_AT_ONCE)
            .map(|nth| too_short + nth * step)
            .take_while(|&limit| limit < reached)
            .collect();
        if core::mem::take(&mut tries_what_is_reached) {
            limits.push(reached);
        }
        let mut found: Vec<Option<Vec<u32>>> = std::thread::scope(|scope| {
            let dealer = &dealer;
            let mut tries = Vec::with_capacity(limits.len());
            for &limit in &limits {
                tries.push(scope.spawn(move || dealer.deal_within(limit)));
            }
            (tries.into_iter())
                .map(|it| it.join().expect("dealing does not panic"))
                .collect()
        });
        let Some(at) = found.iter().position(Option::is_some) else {
            too_short = limits.last().copied().unwrap_or(reached);
            continue;
        };
        if at > 0 {
            too_short = limits[at - 1];
        }
        let shard_of = found[at].take().expect("found above");
        keep_if_better(&mut best, dealer.weigh(shard_of));
        reached = limits[at].min(best.longest);
    }
    best
}
