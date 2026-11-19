use crate::ir::Id;
use crate::ir::generated::Layout;

const NOT_SEEN: usize = usize::MAX;

pub(super) fn cut_rings_of_bases(layouts: &mut [Layout]) {
    let mut seen_from = vec![NOT_SEEN; layouts.len()];
    for start in 0..layouts.len() {
        let mut current = start;
        while seen_from[current] == NOT_SEEN {
            seen_from[current] = start;
            let Some(base) = layouts[current].base else {
                break;
            };
            current = base.index();
        }
        if seen_from[current] != start {
            continue;
        }
        while let Some(base) = layouts[current].base.take() {
            current = base.index();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::cut_rings_of_bases;
    use crate::ir::generated::Layout;
    use crate::ir::{Id, LayoutId};

    #[test]
    fn layouts_whose_bases_come_round_lose_them_and_whoever_stands_below_keeps_its_own() {
        let bases = [Some(1), Some(2), Some(1), None, Some(3), Some(0), Some(6)];
        let layout = |base: Option<usize>| Layout {
            base: base.map(LayoutId::new),
            ..Layout::default()
        };
        let mut layouts = bases.map(layout);
        cut_rings_of_bases(&mut layouts);
        let left = layouts.map(|it| it.base.map(|base| base.index()));
        assert_eq!(left, [Some(1), None, None, None, Some(3), Some(0), None]);
    }
}
