use core::cmp::Reverse;

use crate::cut_model::{
    CutCapacity, CutModel, CutPlan, Fill, NoCutReason, RemovableBytes, Uncut, UncutReason,
};
use crate::image::AddressRange;

pub(crate) fn choose_cuts(model: &CutModel, removable: &[RemovableBytes]) -> CutPlan {
    let runs = find_runs(removable);
    let alignment = model.alignment;
    if !alignment.is_power_of_two() {
        let bytes: u64 = runs.iter().map(|run| run.len()).sum();
        return plan_without_cuts(removable, NoCutReason::HeadersUnreadable, bytes);
    }
    let max_cuts = match model.capacity {
        CutCapacity::Cuts(max_cuts) => max_cuts,
        CutCapacity::NoCuts(reason) => {
            let bytes: u64 = runs
                .iter()
                .filter_map(|run| align_inward(*run, alignment))
                .map(|candidate| candidate.len())
                .sum();
            return plan_without_cuts(removable, reason, bytes);
        }
    };
    let mut cuts: Vec<AddressRange> = clip_to_spans(&runs, &model.cuttable_spans)
        .into_iter()
        .filter_map(|piece| align_inward(piece, alignment))
        .filter(|candidate| leaves_one_piece(*candidate, &model.spans_cut_only_at_end))
        .collect();
    cuts.sort_by_key(|candidate| (Reverse(candidate.len()), candidate.start));
    let over_budget = cuts.split_off(max_cuts.min(cuts.len()));
    let uncut = (!over_budget.is_empty()).then(|| Uncut {
        reason: UncutReason::BudgetSpent,
        bytes: over_budget.iter().map(|candidate| candidate.len()).sum(),
    });
    cuts.sort_by_key(|cut| cut.start);
    let fills = compute_fills(removable, &cuts);
    CutPlan { cuts, fills, uncut }
}

fn plan_without_cuts(removable: &[RemovableBytes], reason: NoCutReason, bytes: u64) -> CutPlan {
    CutPlan {
        cuts: Vec::new(),
        fills: compute_fills(removable, &[]),
        uncut: (bytes > 0).then_some(Uncut {
            reason: UncutReason::NoCuts(reason),
            bytes,
        }),
    }
}

fn find_runs(removable: &[RemovableBytes]) -> Vec<AddressRange> {
    let mut runs = Vec::new();
    let mut open_run: Option<AddressRange> = None;
    for element in removable {
        if !element.can_be_cut {
            runs.extend(open_run.take());
            continue;
        }
        let range = element.range;
        open_run = match open_run {
            None => Some(range),
            Some(run) if run.end == range.start => Some(AddressRange {
                start: run.start,
                end: range.end,
            }),
            Some(run) => {
                runs.push(run);
                Some(range)
            }
        };
    }
    runs.extend(open_run);
    runs
}

fn clip_to_spans(runs: &[AddressRange], spans: &[AddressRange]) -> Vec<AddressRange> {
    let mut pieces = Vec::with_capacity(runs.len());
    let mut next_span = 0;
    for run in runs {
        while let Some(span) = spans.get(next_span) {
            if span.start >= run.end {
                break;
            }
            let start = run.start.max(span.start);
            let end = run.end.min(span.end);
            if start < end {
                pieces.push(AddressRange { start, end });
            }
            if span.end > run.end {
                break;
            }
            next_span += 1;
        }
    }
    pieces
}

fn leaves_one_piece(candidate: AddressRange, spans_cut_only_at_end: &[AddressRange]) -> bool {
    spans_cut_only_at_end
        .iter()
        .all(|span| !span.contains(candidate) || candidate.end == span.end)
}

fn align_inward(run: AddressRange, alignment: u64) -> Option<AddressRange> {
    let mask = alignment - 1;
    let start = run.start.checked_add(mask)? & !mask;
    let end = run.end & !mask;
    (start < end).then_some(AddressRange { start, end })
}

fn compute_fills(removable: &[RemovableBytes], cuts: &[AddressRange]) -> Vec<Fill> {
    let mut fills = Vec::with_capacity(removable.len());
    let mut next_cut = 0;
    for element in removable {
        let end = element.range.end;
        let mut start = element.range.start;
        let mut push_fill = |start: u64, end: u64| {
            if element.can_be_filled && start < end {
                fills.push(Fill {
                    range: AddressRange { start, end },
                    is_code: element.is_code,
                });
            }
        };
        while let Some(cut) = cuts.get(next_cut) {
            if cut.start >= end {
                break;
            }
            push_fill(start, cut.start);
            start = start.max(cut.end);
            if cut.end > end {
                break;
            }
            next_cut += 1;
        }
        push_fill(start, end);
    }
    fills
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::ExecutableFormat;

    const PAGE: u64 = 4096;

    #[derive(Copy, Clone)]
    struct Limits {
        alignment: u64,
        max_cuts: usize,
    }

    const LIMITS: Limits = Limits {
        alignment: PAGE,
        max_cuts: 16,
    };

    fn range(start: u64, end: u64) -> AddressRange {
        AddressRange { start, end }
    }

    fn cuttable(start: u64, end: u64, is_code: bool) -> RemovableBytes {
        RemovableBytes {
            range: range(start, end),
            is_code,
            can_be_cut: true,
            can_be_filled: true,
        }
    }

    fn fill_only(start: u64, end: u64) -> RemovableBytes {
        RemovableBytes {
            range: range(start, end),
            is_code: false,
            can_be_cut: false,
            can_be_filled: true,
        }
    }

    fn cut_only(start: u64, end: u64) -> RemovableBytes {
        RemovableBytes {
            range: range(start, end),
            is_code: false,
            can_be_cut: true,
            can_be_filled: false,
        }
    }

    fn fill(start: u64, end: u64, is_code: bool) -> Fill {
        Fill {
            range: range(start, end),
            is_code,
        }
    }

    fn no_cuts(reason: NoCutReason, bytes: u64) -> Option<Uncut> {
        Some(Uncut {
            reason: UncutReason::NoCuts(reason),
            bytes,
        })
    }

    fn budget_spent(bytes: u64) -> Option<Uncut> {
        Some(Uncut {
            reason: UncutReason::BudgetSpent,
            bytes,
        })
    }

    fn choose_in_spans(
        removable: &[RemovableBytes],
        limits: Limits,
        cuttable_spans: Vec<AddressRange>,
    ) -> CutPlan {
        let model = CutModel {
            format: ExecutableFormat::Elf,
            alignment: limits.alignment,
            capacity: CutCapacity::from_free_slots(limits.max_cuts),
            cuttable_spans,
            spans_cut_only_at_end: Vec::new(),
        };
        choose_cuts(&model, removable)
    }

    fn choose(removable: &[RemovableBytes], limits: Limits) -> CutPlan {
        choose_in_spans(removable, limits, vec![range(0, u64::MAX)])
    }

    fn one_fill_per_element(removable: &[RemovableBytes]) -> Vec<Fill> {
        removable
            .iter()
            .map(|element| Fill {
                range: element.range,
                is_code: element.is_code,
            })
            .collect()
    }

    fn count_cut_bytes(range: AddressRange, cuts: &[AddressRange]) -> u64 {
        cuts.iter()
            .map(|cut| {
                cut.end
                    .min(range.end)
                    .saturating_sub(cut.start.max(range.start))
            })
            .sum()
    }

    fn assert_tiles_input(removable: &[RemovableBytes], plan: &CutPlan) {
        let mut pieces: Vec<AddressRange> = plan.cuts.clone();
        pieces.extend(plan.fills.iter().map(|fill| fill.range));
        pieces.sort_by_key(|piece| piece.start);
        assert!(pieces.windows(2).all(|pair| pair[0].end <= pair[1].start));
        assert!(plan.cuts.is_sorted_by_key(|cut| cut.start));
        assert!(plan.fills.is_sorted_by_key(|fill| fill.range.start));

        let cut_bytes = |element: &RemovableBytes| count_cut_bytes(element.range, &plan.cuts);
        let cut_input_bytes: u64 = removable.iter().map(cut_bytes).sum();
        let uncut_fillable_bytes: u64 = removable
            .iter()
            .filter(|element| element.can_be_filled)
            .map(|element| element.range.len() - cut_bytes(element))
            .sum();
        assert_eq!(
            plan.cut_bytes() + plan.filled_bytes(),
            cut_input_bytes + uncut_fillable_bytes
        );
        assert_eq!(plan.cut_bytes(), cut_input_bytes);
        let is_in_fillable_element = |fill: &Fill| {
            removable.iter().any(|element| {
                element.can_be_filled
                    && element.is_code == fill.is_code
                    && element.range.contains(fill.range)
            })
        };
        assert!(plan.fills.iter().all(is_in_fillable_element));
    }

    #[test]
    fn adjacent_ranges_form_one_cut_rounded_inward() {
        let removable = [
            cuttable(100, 5000, true),
            cuttable(5000, 20000, false),
            cuttable(20000, 30000, true),
        ];
        let plan = choose(&removable, LIMITS);
        assert_eq!(plan.cuts, [range(4096, 28672)]);
        assert_eq!(
            plan.fills,
            [fill(100, 4096, true), fill(28672, 30000, true)]
        );
        assert_eq!(plan.uncut, None);
    }

    #[test]
    fn ragged_ends_keep_element_kind() {
        let removable = [cuttable(100, 5000, false), cuttable(5000, 30000, true)];
        let plan = choose(&removable, LIMITS);
        assert_eq!(plan.cuts, [range(4096, 28672)]);
        assert_eq!(
            plan.fills,
            [fill(100, 4096, false), fill(28672, 30000, true)]
        );
    }

    #[test]
    fn gap_of_one_byte_makes_two_runs() {
        let removable = [cuttable(0, 16384, true), cuttable(16385, 32769, true)];
        let plan = choose(&removable, LIMITS);
        assert_eq!(plan.cuts, [range(0, 16384), range(20480, 32768)]);
        assert_eq!(
            plan.fills,
            [fill(16385, 20480, true), fill(32768, 32769, true)]
        );
    }

    #[test]
    fn range_without_cut_splits_runs_and_is_filled() {
        let removable = [
            cuttable(0, 16384, true),
            fill_only(16384, 20480),
            cuttable(20480, 36864, true),
        ];
        let plan = choose(&removable, LIMITS);
        assert_eq!(plan.cuts, [range(0, 16384), range(20480, 36864)]);
        assert_eq!(plan.fills, [fill(16384, 20480, false)]);
    }

    #[test]
    fn longest_candidates_are_cut_in_address_order() {
        let removable = [
            cuttable(0, 3 * PAGE, true),
            cuttable(10 * PAGE, 16 * PAGE, true),
            cuttable(20 * PAGE, 24 * PAGE, true),
            cuttable(30 * PAGE, 35 * PAGE, true),
            cuttable(40 * PAGE, 42 * PAGE, true),
        ];
        let limits = Limits {
            alignment: PAGE,
            max_cuts: 2,
        };
        let plan = choose(&removable, limits);
        assert_eq!(
            plan.cuts,
            [range(10 * PAGE, 16 * PAGE), range(30 * PAGE, 35 * PAGE)]
        );
        assert_eq!(plan.fills.len(), 3);
        assert_tiles_input(&removable, &plan);
    }

    #[test]
    fn lower_candidate_wins_tie() {
        let removable = [
            cuttable(0, 4 * PAGE, true),
            cuttable(10 * PAGE, 14 * PAGE, true),
        ];
        let limits = Limits {
            alignment: PAGE,
            max_cuts: 1,
        };
        assert_eq!(choose(&removable, limits).cuts, [range(0, 4 * PAGE)]);
    }

    #[test]
    fn cuts_and_fills_tile_generated_lists() {
        let mut state: u64 = 0x2545_f491_4f6c_dd1d;
        let mut next = move |bound: u64| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (state >> 33) % bound
        };
        for _ in 0..1000 {
            let mut removable = Vec::new();
            let mut address = next(PAGE);
            for _ in 0..next(40) {
                let end = address + 1 + next(6 * PAGE);
                removable.push(RemovableBytes {
                    range: range(address, end),
                    is_code: next(2) == 0,
                    can_be_cut: next(5) != 0,
                    can_be_filled: next(4) != 0,
                });
                address = end + if next(3) == 0 { next(PAGE) } else { 0 };
            }
            let limits = Limits {
                alignment: PAGE,
                max_cuts: next(5) as usize,
            };
            let plan = choose(&removable, limits);
            assert!(plan.cuts.len() <= limits.max_cuts);
            assert!(plan.cuts.iter().all(|cut| cut.len() >= PAGE));
            assert_tiles_input(&removable, &plan);
            assert_eq!(plan, choose(&removable, limits));
        }
    }

    #[test]
    fn run_shorter_than_aligned_unit_is_only_filled() {
        for removable in [
            [cuttable(0, PAGE - 1, true)],
            [cuttable(1, 2 * PAGE - 1, true)],
        ] {
            let plan = choose(&removable, LIMITS);
            assert!(plan.cuts.is_empty());
            assert_eq!(plan.fills, one_fill_per_element(&removable));
            assert_eq!(plan.uncut, None);
        }
    }

    #[test]
    fn candidate_shorter_than_alignment_is_only_filled() {
        let removable = [cuttable(0, 4 * PAGE, true)];
        let limits = Limits {
            alignment: 8 * PAGE,
            max_cuts: 16,
        };
        assert!(choose(&removable, limits).cuts.is_empty());
    }

    #[test]
    fn one_page_run_is_cut_while_budget_lasts() {
        let removable = [cuttable(0, PAGE, true), cuttable(2 * PAGE, 6 * PAGE, true)];
        let plan = choose(&removable, LIMITS);
        assert_eq!(plan.cuts, [range(0, PAGE), range(2 * PAGE, 6 * PAGE)]);
        assert!(plan.fills.is_empty());
        assert_eq!(plan.uncut, None);

        let one_cut = Limits {
            alignment: PAGE,
            max_cuts: 1,
        };
        let plan = choose(&removable, one_cut);
        assert_eq!(plan.cuts, [range(2 * PAGE, 6 * PAGE)]);
        assert_eq!(plan.fills, [fill(0, PAGE, true)]);
        assert_eq!(plan.uncut, budget_spent(PAGE));
    }

    #[test]
    fn budget_spent_reports_uncut_bytes() {
        let removable = [
            cuttable(100, 3 * PAGE, true),
            cuttable(10 * PAGE, 16 * PAGE, true),
            cuttable(20 * PAGE, 24 * PAGE, true),
        ];
        let uncut_with = |max_cuts: usize| {
            let limits = Limits {
                alignment: PAGE,
                max_cuts,
            };
            choose(&removable, limits).uncut
        };
        assert_eq!(uncut_with(1), budget_spent(6 * PAGE));
        assert_eq!(uncut_with(2), budget_spent(2 * PAGE));
        assert_eq!(uncut_with(3), None);
    }

    #[test]
    fn no_cuts_allowed_fills_every_element() {
        let removable = [
            cuttable(0, 16 * PAGE, true),
            fill_only(16 * PAGE, 17 * PAGE),
        ];
        let limits = Limits {
            alignment: PAGE,
            max_cuts: 0,
        };
        let plan = choose(&removable, limits);
        assert!(plan.cuts.is_empty());
        assert_eq!(plan.fills, one_fill_per_element(&removable));
        assert_eq!(
            plan.uncut,
            no_cuts(NoCutReason::HeaderRoomExhausted, 16 * PAGE)
        );
    }

    #[test]
    fn no_cuts_allowed_without_candidate_reports_nothing() {
        let removable = [
            cuttable(1, 2 * PAGE - 1, true),
            fill_only(4 * PAGE, 8 * PAGE),
        ];
        let limits = Limits {
            alignment: PAGE,
            max_cuts: 0,
        };
        let plan = choose(&removable, limits);
        assert_eq!(plan.fills, one_fill_per_element(&removable));
        assert_eq!(plan.uncut, None);
    }

    #[test]
    fn invalid_alignment_fills_every_element() {
        let removable = [cuttable(100, 16 * PAGE, true)];
        for alignment in [0, 3000] {
            let limits = Limits {
                alignment,
                max_cuts: 16,
            };
            let plan = choose(&removable, limits);
            assert!(plan.cuts.is_empty());
            assert_eq!(plan.fills, one_fill_per_element(&removable));
            assert_eq!(
                plan.uncut,
                no_cuts(NoCutReason::HeadersUnreadable, 16 * PAGE - 100)
            );
        }
    }

    #[test]
    fn unfillable_element_is_cut_without_fills() {
        let removable = [cut_only(100, 20000), cuttable(20000, 30000, true)];
        let plan = choose(&removable, LIMITS);
        assert_eq!(plan.cuts, [range(4096, 28672)]);
        assert_eq!(plan.fills, [fill(28672, 30000, true)]);
        assert_eq!(plan.cut_bytes() + plan.filled_bytes(), 30000 - 4096);
    }

    #[test]
    fn short_unfillable_element_is_left_unchanged() {
        let removable = [cut_only(100, 5000), cuttable(5000, 8000, false)];
        let plan = choose(&removable, LIMITS);
        assert!(plan.cuts.is_empty());
        assert_eq!(plan.fills, [fill(5000, 8000, false)]);
        assert_eq!(plan.cut_bytes() + plan.filled_bytes(), 3000);
    }

    #[test]
    fn no_cuts_allowed_leaves_unfillable_element_unchanged() {
        let removable = [cut_only(0, 16 * PAGE), fill_only(16 * PAGE, 17 * PAGE)];
        let limits = Limits {
            alignment: PAGE,
            max_cuts: 0,
        };
        let plan = choose(&removable, limits);
        assert!(plan.cuts.is_empty());
        assert_eq!(plan.fills, [fill(16 * PAGE, 17 * PAGE, false)]);
        assert_eq!(
            plan.uncut,
            no_cuts(NoCutReason::HeaderRoomExhausted, 16 * PAGE)
        );
    }

    #[test]
    fn span_boundary_splits_run() {
        let removable = [
            cuttable(0, 4 * PAGE, true),
            cuttable(4 * PAGE, 8 * PAGE, true),
        ];
        let spans = vec![range(0, 4 * PAGE), range(4 * PAGE, 8 * PAGE)];
        let plan = choose_in_spans(&removable, LIMITS, spans);
        assert_eq!(plan.cuts, [range(0, 4 * PAGE), range(4 * PAGE, 8 * PAGE)]);
        assert!(plan.fills.is_empty());
    }

    #[test]
    fn run_is_clipped_to_span() {
        let removable = [cuttable(6 * PAGE, 12 * PAGE, true)];
        let plan = choose_in_spans(&removable, LIMITS, vec![range(8 * PAGE, 10 * PAGE)]);
        assert_eq!(plan.cuts, [range(8 * PAGE, 10 * PAGE)]);
        let expected_fills = [
            fill(6 * PAGE, 8 * PAGE, true),
            fill(10 * PAGE, 12 * PAGE, true),
        ];
        assert_eq!(plan.fills, expected_fills);
    }

    #[test]
    fn run_outside_every_span_is_filled() {
        let removable = [
            cuttable(0, 4 * PAGE, true),
            cuttable(10 * PAGE, 14 * PAGE, true),
            cuttable(20 * PAGE, 24 * PAGE, true),
            cuttable(40 * PAGE, 44 * PAGE, true),
        ];
        let plan = choose_in_spans(&removable, LIMITS, vec![range(8 * PAGE, 32 * PAGE)]);
        assert_eq!(
            plan.cuts,
            [range(10 * PAGE, 14 * PAGE), range(20 * PAGE, 24 * PAGE)]
        );
        assert_eq!(
            plan.fills,
            [fill(0, 4 * PAGE, true), fill(40 * PAGE, 44 * PAGE, true)]
        );
        assert_eq!(plan.uncut, None);
    }

    #[test]
    fn span_cut_only_at_end_stays_one_piece() {
        let removable = [
            cuttable(2 * PAGE, 4 * PAGE, true),
            cuttable(9 * PAGE, 12 * PAGE, false),
            cuttable(14 * PAGE, 16 * PAGE, false),
            cuttable(16 * PAGE, 18 * PAGE, false),
        ];
        let model = CutModel {
            format: ExecutableFormat::MachO,
            alignment: PAGE,
            capacity: CutCapacity::from_free_slots(LIMITS.max_cuts),
            cuttable_spans: vec![
                range(0, 8 * PAGE),
                range(8 * PAGE, 16 * PAGE),
                range(16 * PAGE, 20 * PAGE),
            ],
            spans_cut_only_at_end: vec![range(8 * PAGE, 16 * PAGE)],
        };
        let plan = choose_cuts(&model, &removable);
        assert_eq!(
            plan.cuts,
            [
                range(2 * PAGE, 4 * PAGE),
                range(14 * PAGE, 16 * PAGE),
                range(16 * PAGE, 18 * PAGE)
            ]
        );
        assert_eq!(plan.fills, [fill(9 * PAGE, 12 * PAGE, false)]);
        assert_eq!(plan.uncut, None);
        assert_tiles_input(&removable, &plan);
    }

    #[test]
    fn empty_input_gives_empty_plan() {
        assert_eq!(choose(&[], LIMITS), CutPlan::default());
    }
}
