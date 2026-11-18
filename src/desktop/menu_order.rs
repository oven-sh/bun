//! Where `before`, `after`, `beforeGroupContaining` and `afterGroupContaining` put the items of a template.

use crate::generated_bindgen::menu::MenuItemPlace;

type Ids = Option<Vec<bun_core::Utf8Bytes<'static>>>;

fn ids(all: &Ids) -> impl Iterator<Item = &[u8]> {
    all.iter().flatten().map(|it| &**it)
}

fn is_separator(it: &MenuItemPlace) -> bool {
    it.kind.as_deref() == Some(b"separator")
}

/// `first[i]` come before `i`. Cycles are broken.
fn sorted(first: &[Vec<usize>]) -> Vec<usize> {
    let (mut order, mut is_seen) = (Vec::new(), vec![false; first.len()]);
    for start in 0..first.len() {
        let mut path = vec![(start, 0)];
        while let Some((node, next)) = path.pop() {
            if next == 0 && core::mem::replace(&mut is_seen[node], true) {
                continue;
            }
            match first[node].get(next) {
                Some(other) => path.extend([(node, next + 1), (*other, 0)]),
                None => order.push(node),
            }
        }
    }
    order
}

/// The indices of what is left of `items`. `None` is a separator that it does not have.
pub(crate) fn arrange(items: &[MenuItemPlace]) -> Vec<Option<usize>> {
    let is_placed = |it: &MenuItemPlace| {
        [
            &it.before,
            &it.after,
            &it.before_group_containing,
            &it.after_group_containing,
        ]
        .iter()
        .any(|it| it.is_some())
    };
    let (mut groups, mut separators) = (vec![Vec::new()], Vec::new());
    for (index, item) in items.iter().enumerate() {
        if is_separator(item) && !is_placed(item) {
            separators.push(index);
            groups.push(Vec::new());
        } else if let Some(group) = groups.last_mut() {
            group.push(index);
        }
    }
    groups.retain(|it| !it.is_empty());

    let has_id = |index: usize, id: &[u8]| items[index].id.as_deref() == Some(id);
    let group_with = |groups: &[Vec<usize>], id: &[u8], except: usize| {
        (0..groups.len()).find(|it| *it != except && groups[*it].iter().any(|it| has_id(*it, id)))
    };
    while let Some((from, to)) = (0..groups.len()).find_map(|from| {
        let mut wanted = groups[from]
            .iter()
            .flat_map(|it| ids(&items[*it].before).chain(ids(&items[*it].after)));
        Some((from, wanted.find_map(|id| group_with(&groups, id, from))?))
    }) {
        let moved = core::mem::take(&mut groups[from]);
        groups[to].extend(moved);
        groups.remove(from);
    }

    for group in &mut groups {
        let mut first = vec![Vec::new(); group.len()];
        let position = |id| group.iter().rposition(|it| has_id(*it, id));
        for (at, item) in group.iter().map(|it| &items[*it]).enumerate() {
            ids(&item.before)
                .filter_map(position)
                .for_each(|other| first[other].push(at));
            first[at].extend(ids(&item.after).filter_map(position));
        }
        *group = sorted(&first).into_iter().map(|it| group[it]).collect();
    }

    let mut first = vec![Vec::new(); groups.len()];
    for (at, group) in groups.iter().enumerate() {
        let other = |all| ids(all).find_map(|id| group_with(&groups, id, at));
        let edge = group.iter().map(|it| &items[*it]).find_map(|it| {
            (other(&it.before_group_containing).map(|other| (other, at)))
                .or_else(|| Some((at, other(&it.after_group_containing)?)))
        });
        if let Some((later, earlier)) = edge {
            first[later].push(earlier);
        }
    }

    let (mut joined, mut separators) = (Vec::new(), separators.into_iter());
    for (at, group) in sorted(&first).into_iter().enumerate() {
        if at > 0 {
            joined.push(separators.next());
        }
        joined.extend(groups[group].iter().map(|it| Some(*it)));
    }

    let is_extra = |it: Option<usize>| {
        it.is_none_or(|it| is_separator(&items[it]) && items[it].visible != Some(false))
    };
    joined.dedup_by(|it, before| is_extra(*it) && before.is_none_or(|it| is_separator(&items[it])));
    joined.pop_if(|it| is_extra(*it));
    let first = usize::from(joined.first().is_some_and(|it| is_extra(*it)));
    joined.split_off(first)
}
