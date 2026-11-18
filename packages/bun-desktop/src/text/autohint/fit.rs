//! Moves edges to the grid. Stems keep their widths.
//!
//! Derived from the auto-hinter of FreeType and its port in skrifa. Copyright (c) The FreeType Project (www.freetype.org),
//! (c) 2019 Fontations Developers. FreeType License and MIT, see `licenses/freetype.txt` and `licenses/fontations.txt`.

use super::edges::Edge;
use super::scripts::Group;
use super::{mul_div, round};

fn move_with(edges: &mut [Edge], base: usize, other: usize) {
    edges[other].fitted = edges[base].fitted + edges[other].scaled - edges[base].scaled;
}

fn fit_to_zones(edges: &mut [Edge]) -> Option<usize> {
    let mut anchor = None;
    for index in 0..edges.len() {
        let edge = edges[index];
        if edge.is_done {
            continue;
        }
        if let Some(link) = edge
            .link
            .filter(|it| edge.zone.is_some() && edges[*it].zone.is_some())
            && let Some(neutral) = [link, index].into_iter().find(|it| edges[*it].is_neutral)
        {
            (edges[neutral].zone, edges[neutral].is_neutral) = (None, false);
        }
        let Some((first, zone)) = [Some(index), edge.link]
            .into_iter()
            .flatten()
            .find_map(|it| Some((it, edges[it].zone?)))
        else {
            continue;
        };
        if edges[first].is_done {
            continue;
        }
        (edges[first].fitted, edges[first].is_done) = (zone, true);
        if let Some(second) = (if first == index {
            edge.link
        } else {
            Some(index)
        })
        .filter(|it| edges[*it].zone.is_none())
        {
            edges[second].is_done = true;
            move_with(edges, first, second);
        }
        anchor.get_or_insert(index);
    }
    anchor
}

fn fit_center(center: i32, len: i32) -> i32 {
    let (up, down) = if len <= 64 { (32, 32) } else { (38, 26) };
    let [low, high] = [round(center) - up, round(center) + down];
    if (center - low).abs() < (center - high).abs() {
        low
    } else {
        high
    }
}

fn keep_order(edges: &mut [Edge], index: usize, is_next: bool, goes_down: bool) -> Option<()> {
    let previous = edges[index.checked_sub(1)?].fitted;
    let bound = if is_next {
        edges.get(index + 1).filter(|it| it.is_done)?.fitted
    } else {
        previous
    };
    let is_beyond = if is_next != goes_down {
        edges[index].fitted > bound
    } else {
        edges[index].fitted < bound
    };
    if is_beyond && (edges[edges[index].link?].fitted - previous).abs() > 16 {
        edges[index].fitted = bound;
    }
    Some(())
}

fn fit_stem(edges: &mut [Edge], index: usize, link: usize, anchor: Option<usize>, goes_down: bool) {
    let len = edges[link].scaled - edges[index].scaled;
    edges[index].is_done = true;
    let Some(anchor) = anchor else {
        let start = edges[index].scaled;
        edges[index].fitted = if len < 96 {
            fit_center(start + (len >> 1), len) - len / 2
        } else {
            round(start)
        };
        return move_with(edges, index, link);
    };
    let start = edges[anchor].fitted + edges[index].scaled - edges[anchor].scaled;
    if edges[link].is_done {
        move_with(edges, link, index);
    } else if len < 96 {
        let center = fit_center(start + (len >> 1), len);
        (edges[index].fitted, edges[link].fitted) = (center - len / 2, center + len / 2);
    } else {
        let [by_start, by_end] = [round(start), round(start + len) - len];
        edges[index].fitted = if (by_start - start).abs() < (by_end - start).abs() {
            by_start
        } else {
            by_end
        };
        move_with(edges, index, link);
    }
    edges[link].is_done = true;
    keep_order(edges, index, false, goes_down);
}

/// Returns by how much it moved.
fn fit_cjk_stem(edges: &mut [Edge], index: usize, link: usize, along: usize, shift: i32) -> i32 {
    let (edge, other) = (edges[index], edges[link]);
    let threshold = 64
        - [15, 9][along]
            / if edge.is_round && other.is_round {
                1
            } else {
                3
            };
    let len = other.scaled - edge.scaled;
    let start = (edge.scaled + other.scaled) / 2 + shift - len / 2;
    let (down, offset) = ([start & 63, (start + len) & 63], len & 63);
    let up = down.map(|it| 64 - it);
    let by = if down.contains(&0) {
        0
    } else if len <= threshold {
        if down[1] >= len {
            0
        } else if up[0] <= down[1] {
            up[0]
        } else {
            -down[1]
        }
    } else if down.iter().chain(&up).any(|it| *it >= threshold)
        || offset < 32 && (up[0] <= offset || down[1] <= offset)
    {
        0
    } else {
        let offset = if offset < 32 { offset } else { 64 - threshold };
        let first = if threshold - up[0] <= up[0] - offset {
            up[0] - threshold
        } else {
            up[0] - offset
        };
        let second = if down[1] - offset <= threshold - down[1] {
            offset - down[1]
        } else {
            threshold - down[1]
        };
        if first.abs() <= second.abs() {
            first
        } else {
            second
        }
    };
    let (by, [low, high]) = (
        by.clamp(-14, 14),
        if len > 0 {
            [index, link]
        } else {
            [link, index]
        },
    );
    edges[low].fitted = start + by;
    edges[high].fitted = start + by + len;
    by
}

fn space_three_stems_evenly(edges: &mut [Edge]) {
    let [a, b, c] = match edges.len() {
        6 => [0, 2, 4],
        12 => [1, 5, 9],
        _ => return,
    };
    if [a, b, c].iter().all(|it| edges[*it].link == Some(it + 1))
        && (2 * edges[b].scaled - edges[a].scaled - edges[c].scaled).abs() < 8
    {
        let by = edges[c].fitted - (2 * edges[b].fitted - edges[a].fitted);
        edges[c..c + 2]
            .iter_mut()
            .for_each(|it| (it.fitted, it.is_done) = (it.fitted - by, true));
        edges
            .iter_mut()
            .skip(8)
            .step_by(3)
            .for_each(|it| it.fitted -= by);
    }
}

fn done_around(edges: &[Edge], index: usize) -> [Option<usize>; 2] {
    [
        edges[..index].iter().rposition(|it| it.is_done),
        (index + 1..edges.len()).find(|it| edges[*it].is_done),
    ]
}

fn between(before: Edge, after: Edge, edge: Edge, position: fn(Edge) -> i32) -> i32 {
    match position(after) - position(before) {
        0 => before.fitted,
        span => {
            before.fitted
                + mul_div(
                    position(edge) - position(before),
                    after.fitted - before.fitted,
                    span,
                )
        }
    }
}

pub fn fit(edges: &mut [Edge], along: usize, group: Group) {
    let (mut anchor, goes_down) = (fit_to_zones(edges), group == Group::Hanging);
    let (mut last_stem, mut shift) = (None, 0);
    for index in 0..edges.len() {
        let edge = edges[index];
        let Some(link) = edge.link.filter(|_| !edge.is_done) else {
            continue;
        };
        if last_stem.is_some_and(|last| edge.fitted.min(edges[link].fitted) < last + 64) {
            continue;
        }
        if edges[link].zone.is_some() {
            move_with(edges, link, index);
            edges[index].is_done = true;
        } else if group != Group::Cjk {
            fit_stem(edges, index, link, anchor, goes_down);
            anchor.get_or_insert(index);
        } else if link < index {
            (last_stem, edges[index].is_done) = (Some(edge.fitted), true);
            move_with(edges, link, index);
        } else {
            let by = fit_cjk_stem(edges, index, link, along, shift);
            shift = if along == 0 && anchor.replace(index).is_none() {
                by
            } else {
                shift
            };
            (edges[index].is_done, edges[link].is_done, last_stem) =
                (true, true, Some(edges[link].fitted));
        }
    }
    if group != Group::Cjk {
        for index in 0..edges.len() {
            let edge = edges[index];
            if edge.is_done {
                continue;
            }
            if let Some(serif) = edge
                .serif
                .filter(|it| (edges[*it].scaled - edge.scaled).abs() < 80)
            {
                move_with(edges, serif, index);
            } else {
                edges[index].fitted = match (anchor, done_around(edges, index)) {
                    (Some(_), [Some(before), Some(after)]) => {
                        between(edges[before], edges[after], edge, |it| it.scaled)
                    }
                    (Some(anchor), _) => {
                        edges[anchor].fitted + ((edge.scaled - edges[anchor].scaled + 16) & !31)
                    }
                    (None, _) => round(edge.scaled),
                };
                anchor.get_or_insert(index);
            }
            edges[index].is_done = true;
            keep_order(edges, index, false, goes_down);
            keep_order(edges, index, true, goes_down);
        }
        return;
    }
    if along == 0 {
        space_three_stems_evenly(edges);
    }
    for index in 0..edges.len() {
        if let Some(serif) = edges[index].serif.filter(|_| !edges[index].is_done) {
            edges[index].is_done = true;
            move_with(edges, serif, index);
        }
    }
    for index in 0..edges.len() {
        match done_around(edges, index) {
            _ if edges[index].is_done => {}
            [Some(before), Some(after)] => {
                edges[index].fitted =
                    between(edges[before], edges[after], edges[index], |it| it.units)
            }
            [Some(only), None] | [None, Some(only)] => move_with(edges, only, index),
            [None, None] => {}
        }
    }
}
