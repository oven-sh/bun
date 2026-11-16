//! When the animation elements of SVG are active. https://www.w3.org/TR/SMIL3/smil-timing.html

use crate::document::Document;
use crate::name::{Map, Name, Set, is_name, name};
use crate::tree::{Element, Namespace, NodeId};

const INDEFINITE: f64 = f64::INFINITY;
const BEGIN: usize = 0;
const END: usize = 1;

type Interval = [f64; 2];

enum Condition {
    Offset(f64),
    /// With `BEGIN` or `END`, and the offset.
    Sync(Name, usize, f64),
    Repeat(Option<Name>, u32, f64),
    /// Scripts watch out for it.
    Event,
}

#[derive(Clone, Copy, PartialEq)]
enum Origin {
    Attribute,
    Script,
    /// With the beginning of its interval.
    Other(NodeId, f64),
}

#[derive(Clone, Copy, Default, PartialEq)]
enum Restart {
    #[default]
    Always,
    WhenNotActive,
    Never,
}

#[derive(Default)]
struct Timed {
    container: NodeId,
    conditions: [Vec<Condition>; 2],
    /// Ascending.
    instances: [Vec<(f64, Origin)>; 2],
    duration: Option<f64>,
    repeat_count: Option<f64>,
    repeat_duration: Option<f64>,
    limits: [f64; 2],
    restart: Restart,
    freezes: bool,
    interval: Option<Interval>,
    previous: Option<Interval>,
    /// What the last events were about.
    active: Option<Interval>,
    iteration: u32,
}

#[derive(Default)]
struct Container {
    /// Where it is, in seconds.
    time: f64,
    /// When that was, unless it does not run.
    since: Option<f64>,
    is_paused: bool,
}

#[derive(Default)]
pub(crate) struct Smil {
    elements: Map<NodeId, Timed>,
    /// Those whose attributes or whose place have changed.
    stale: Set<NodeId>,
    containers: Map<NodeId, Container>,
    has_started: bool,
    /// In milliseconds.
    now: f64,
    pub(crate) needs_update: bool,
    pub(crate) effects: crate::smil_values::Effects,
}

/// How far an animation is.
pub(crate) struct Progress {
    pub(crate) id: NodeId,
    pub(crate) fraction: f32,
    pub(crate) iteration: u32,
}

pub(crate) fn is_animation(element: &Element) -> bool {
    element.namespace == Namespace::Svg
        && is_name!(
            element.tag,
            "animate" | "set" | "animateMotion" | "animateTransform"
        )
}

fn clock(source: &str) -> Option<f64> {
    let (source, number) = (source.trim_ascii(), |it: &str| {
        it.bytes()
            .all(|it| it.is_ascii_digit() || it == b'.')
            .then(|| it.parse::<f64>().ok())?
    });
    if source == "indefinite" {
        return Some(INDEFINITE);
    }
    let parts: Vec<_> = bun_core::strings::split(source.as_bytes(), b":")
        .map(crate::values::text)
        .collect();
    if let [hours @ .., minutes, seconds] = &parts[..] {
        let whole_seconds = seconds.bytes().take_while(u8::is_ascii_digit).count();
        (hours.len() < 2
            && minutes.len() == 2
            && whole_seconds == 2
            && number(minutes)? < 60.0
            && number(seconds)? < 60.0)
            .then_some(())?;
        return Some(
            hours.first().map_or(Some(0.0), |it| number(it))? * 3600.0
                + number(minutes)? * 60.0
                + number(seconds)?,
        );
    }
    let units = [
        ("ms", 0.001),
        ("min", 60.0),
        ("h", 3600.0),
        ("s", 1.0),
        ("", 1.0),
    ];
    units
        .into_iter()
        .find_map(|(unit, factor)| Some(number(source.strip_suffix(unit)?)? * factor))
}

fn offset(source: &str) -> Option<f64> {
    match source.trim_ascii() {
        "" => None,
        it if it.starts_with('-') => clock(&it[1..]).filter(|it| it.is_finite()).map(|it| -it),
        it => clock(it.strip_prefix('+').unwrap_or(it)),
    }
}

fn condition(source: &str) -> Option<Condition> {
    if let Some(time) = offset(source) {
        return Some(Condition::Offset(time));
    }
    let bytes = source.trim_ascii().as_bytes();
    let unescaped = |wanted: &'static [u8]| {
        (0..bytes.len())
            .filter(move |at| wanted.contains(&bytes[*at]) && (*at == 0 || bytes[at - 1] != b'\\'))
    };
    let sign = unescaped(b"+-").find(|at| offset(crate::values::text(&bytes[*at..])).is_some());
    let (base, delay) = (
        bytes[..sign.unwrap_or(bytes.len())].trim_ascii(),
        sign.and_then(|at| offset(crate::values::text(&bytes[at..])))
            .unwrap_or(0.0),
    );
    let dot = unescaped(b".").find(|at| *at < base.len());
    let id = dot.map(|at| {
        Name::new(
            &base[..at]
                .iter()
                .copied()
                .filter(|it| *it != b'\\')
                .collect::<Vec<_>>(),
        )
    });
    Some(match (&base[dot.map_or(0, |it| it + 1)..], id) {
        (b"", _) => return None,
        (b"begin", id) => Condition::Sync(id?, BEGIN, delay),
        (b"end", id) => Condition::Sync(id?, END, delay),
        (event, id) => match event
            .strip_prefix(b"repeat(")
            .and_then(|it| it.strip_suffix(b")"))
        {
            Some(count) => Condition::Repeat(id, crate::values::text(count).parse().ok()?, delay),
            None => Condition::Event,
        },
    })
}

impl Timed {
    fn parse(&mut self, element: &Element) {
        let time = |name| element.attribute(name).and_then(clock);
        for (kind, name) in [(BEGIN, name!("begin")), (END, name!("end"))] {
            let list = element.attribute(name).map(|it| {
                bun_core::strings::split(it.as_bytes(), b";")
                    .filter_map(|it| condition(crate::values::text(it)))
                    .collect()
            });
            self.conditions[kind] = list.unwrap_or_else(|| {
                if kind == BEGIN {
                    vec![Condition::Offset(0.0)]
                } else {
                    Vec::new()
                }
            });
            self.instances[kind].retain(|it| it.1 == Origin::Script);
            self.instances[kind].extend(self.conditions[kind].iter().filter_map(|it| {
                if let Condition::Offset(time) = it {
                    Some((*time, Origin::Attribute))
                } else {
                    None
                }
            }));
            self.instances[kind].sort_by(|a, b| a.0.total_cmp(&b.0));
        }
        (self.duration, self.repeat_duration) = (
            time(name!("dur")).filter(|it| *it > 0.0),
            time(name!("repeatDur")).filter(|it| *it > 0.0),
        );
        let count = element.attribute(name!("repeatCount")).map(str::trim_ascii);
        self.repeat_count = count.and_then(|it| {
            if it == "indefinite" {
                Some(INDEFINITE)
            } else {
                it.parse()
                    .ok()
                    .filter(|it: &f64| *it > 0.0 && it.is_finite())
            }
        });
        self.limits = [
            time(name!("min"))
                .filter(|it| it.is_finite())
                .unwrap_or(0.0),
            time(name!("max"))
                .filter(|it| *it > 0.0)
                .unwrap_or(INDEFINITE),
        ];
        if self.limits[0] > self.limits[1] {
            self.limits = [0.0, INDEFINITE];
        }
        self.freezes = element.attribute(name!("fill")) == Some("freeze");
        self.restart = match element.attribute(name!("restart")) {
            Some("never") => Restart::Never,
            Some("whenNotActive") => Restart::WhenNotActive,
            _ => Restart::Always,
        };
    }

    fn simple_duration(&self) -> f64 {
        self.duration.unwrap_or(INDEFINITE)
    }

    fn repeating_duration(&self) -> f64 {
        match (self.repeat_count, self.repeat_duration) {
            (None, None) => self.simple_duration(),
            (count, duration) => count
                .map_or(INDEFINITE, |it| it * self.simple_duration())
                .min(duration.unwrap_or(INDEFINITE)),
        }
    }

    /// `None` if nothing can end an interval that begins then.
    fn end_for(&self, begin: f64) -> Option<f64> {
        let was_used = |time: f64| {
            self.previous
                .is_some_and(|it| it[END] == time && time == begin)
        };
        let end = self.instances[END]
            .iter()
            .map(|it| it.0)
            .find(|it| *it >= begin && !was_used(*it));
        let may_come = self.instances[END].is_empty()
            || self.conditions[END]
                .iter()
                .any(|it| !matches!(it, Condition::Offset(_)))
            || self.conditions[END].is_empty();
        let duration = self
            .repeating_duration()
            .min(end.or_else(|| may_come.then_some(INDEFINITE))? - begin);
        Some(begin + duration.max(self.limits[0]).min(self.limits[1]))
    }

    /// The first one after the previous one that has not ended by `now`.
    fn resolve(&self, now: f64) -> Option<Interval> {
        (self.previous.is_none() || self.restart != Restart::Never).then_some(())?;
        let mut after = self.previous.map_or(-INDEFINITE, |it| it[END]);
        for begin in self.instances[BEGIN]
            .iter()
            .map(|it| it.0)
            .filter(|it| it.is_finite() && self.previous.is_none_or(|last| *it > last[BEGIN]))
        {
            if begin >= after {
                after = self.end_for(begin)?;
                if after > now || begin >= now || self.previous.is_some() || begin >= 0.0 {
                    return Some([begin, after]);
                }
            }
        }
        None
    }

    /// Whether the interval has changed.
    fn update(&mut self, now: f64) -> bool {
        let before = self.interval;
        match self.interval.filter(|it| it[BEGIN] <= now) {
            None => self.interval = self.resolve(now),
            Some([begin, end]) => {
                let restart = self.instances[BEGIN]
                    .iter()
                    .map(|it| it.0)
                    .find(|it| *it > begin)
                    .filter(|it| self.restart == Restart::Always && *it <= now);
                let end = self
                    .end_for(begin)
                    .unwrap_or(end)
                    .min(restart.unwrap_or(INDEFINITE));
                self.interval = Some([begin, end]);
                if end <= now && before == self.interval {
                    self.previous = self.interval;
                    self.instances
                        .iter_mut()
                        .for_each(|it| it.retain(|it| it.1 == Origin::Attribute || it.0 >= end));
                    self.interval = self.resolve(now);
                }
            }
        }
        self.interval != before
    }

    fn next_change(&self, now: f64) -> f64 {
        let Some([begin, end]) = self.interval else {
            return INDEFINITE;
        };
        if begin > now {
            return begin;
        }
        let restart = self.instances[BEGIN]
            .iter()
            .map(|it| it.0)
            .find(|it| *it > now)
            .filter(|_| self.restart == Restart::Always);
        let repeat = begin + f64::from(self.iteration + 1) * self.simple_duration();
        end.min(restart.unwrap_or(INDEFINITE)).min(
            if repeat > now && repeat < begin + self.repeating_duration() {
                repeat
            } else {
                INDEFINITE
            },
        )
    }

    fn current(&self, now: f64) -> Option<Interval> {
        self.interval.filter(|it| it[BEGIN] <= now && now < it[END])
    }

    /// With the beginning of the interval, unless it has no effect.
    fn progress(&self, now: f64) -> Option<(f64, f32, u32)> {
        let (simple, repeating) = (self.simple_duration(), self.repeating_duration());
        let (begin, elapsed, is_over) = match self.current(now) {
            Some([begin, _]) if now - begin < repeating => (begin, now - begin, false),
            current => current
                .or(self.previous)
                .filter(|_| self.freezes)
                .map(|[begin, end]| (begin, (end - begin).min(repeating), true))?,
        };
        if simple == INDEFINITE {
            return Some((begin, 0.0, 0));
        }
        let cycles = ((elapsed / simple) * 1e9).round() / 1e9;
        Some(if is_over && cycles.fract() == 0.0 && cycles > 0.0 {
            (begin, 1.0, cycles as u32 - 1)
        } else {
            (begin, cycles.fract() as f32, cycles as u32)
        })
    }

    fn add(&mut self, kind: usize, time: f64, origin: Origin, now: f64) {
        if kind == BEGIN
            && self.restart == Restart::WhenNotActive
            && self
                .current(now)
                .is_some_and(|it| time < it[END] && time <= now)
        {
            return;
        }
        let list = &mut self.instances[kind];
        list.insert(list.partition_point(|it| it.0 <= time), (time, origin));
    }
}

impl Smil {
    pub(crate) fn changed(&mut self, id: NodeId) {
        self.stale.insert(id);
        self.needs_update = true;
    }

    pub(crate) fn set_time(&mut self, now: f64) {
        self.now = now.max(self.now);
        self.needs_update = !self.is_empty();
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.elements.is_empty() && self.stale.is_empty()
    }

    pub(crate) fn forget(&mut self, id: NodeId) {
        self.needs_update |= self.elements.remove(&id).is_some();
        self.stale.remove(&id);
        self.containers.remove(&id);
        self.effects.forget(id);
    }

    /// In milliseconds from now.
    pub(crate) fn next_wake(&self) -> f64 {
        let waits = self.elements.values().filter_map(|it| {
            let container = self
                .containers
                .get(&it.container)
                .filter(|it| it.since.is_some())?;
            let is_moving =
                it.current(container.time).is_some() && it.duration.is_some_and(f64::is_finite);
            Some(if is_moving {
                0.0
            } else {
                (it.next_change(container.time) - container.time) * 1000.0
            })
        });
        waits.fold(if self.needs_update { 0.0 } else { INDEFINITE }, f64::min)
    }
}

impl Document {
    fn container(&mut self, svg: NodeId) -> &mut Container {
        let since = self.smil.has_started.then_some(self.smil.now);
        self.smil
            .containers
            .entry(svg)
            .or_insert_with(|| Container {
                since,
                ..Container::default()
            })
    }

    fn members(&self, svg: NodeId) -> Vec<NodeId> {
        let has_any = self.smil.elements.values().any(|it| it.container == svg);
        self.tree
            .descendants(svg)
            .take_while(|_| has_any)
            .filter(|it| {
                self.smil
                    .elements
                    .get(it)
                    .is_some_and(|it| it.container == svg)
            })
            .collect()
    }

    /// Tells those whose conditions are about `source`.
    fn notify(&mut self, members: &[NodeId], source: NodeId, repeat: Option<(u32, f64)>, now: f64) {
        let (Some(name), Some(interval)) = (
            self.tree.element(source).map(|it| it.id),
            self.smil.elements[&source].interval,
        ) else {
            return;
        };
        for (id, kind) in members.iter().flat_map(|it| [(*it, BEGIN), (*it, END)]) {
            let Some(it) = self.smil.elements.get_mut(&id) else {
                continue;
            };
            let times =
                it.conditions[kind]
                    .iter()
                    .filter_map(|condition| match (condition, repeat) {
                        (Condition::Sync(base, edge, offset), None) if *base == name => {
                            Some(interval[*edge] + offset)
                        }
                        (Condition::Repeat(base, count, offset), Some((done, time)))
                            if *count == done && base.map_or(id == source, |it| it == name) =>
                        {
                            Some(time + offset)
                        }
                        _ => None,
                    });
            let (times, origin): (Vec<_>, _) = (
                times.filter(|it| it.is_finite()).collect(),
                Origin::Other(source, repeat.map_or(interval[BEGIN], |it| it.1)),
            );
            let is_obsolete = |(time, known): &(f64, Origin)| {
                *known == origin
                    || repeat.is_none()
                        && *time > now
                        && matches!(known, Origin::Other(from, begin) if *from == source && *begin > now)
            };
            it.instances[kind].retain(|it| !is_obsolete(it));
            times
                .into_iter()
                .for_each(|time| it.add(kind, time, origin, now));
        }
    }

    fn settle_intervals(&mut self, members: &[NodeId], now: f64, fires: bool) {
        for _ in 0..members.len() * 4 + 4 {
            let mut has_changed = false;
            for id in members {
                let Some(it) = self.smil.elements.get_mut(id) else {
                    continue;
                };
                let is_momentary = it.interval.is_some_and(|[begin, end]| {
                    end <= now && it.active.is_none_or(|it| it[BEGIN] != begin)
                });
                if it.update(now) {
                    if fires && is_momentary && it.previous.is_some_and(|it| it[END] <= now) {
                        self.announce(*id, now, true);
                        ["beginEvent", "endEvent"]
                            .into_iter()
                            .for_each(|it| self.emit(it, *id, ",0"));
                    }
                    has_changed = true;
                    self.notify(members, *id, None, now);
                }
            }
            if !has_changed {
                break;
            }
        }
        for id in members {
            let it = &self.smil.elements[id];
            let (current, known) = (it.current(now), it.iteration);
            let iteration = current.and_then(|_| it.progress(now)).map_or(0, |it| it.2);
            self.smil
                .elements
                .get_mut(id)
                .into_iter()
                .for_each(|it| it.iteration = iteration);
            if iteration > known {
                self.notify(members, *id, Some((iteration, now)), now);
            }
            if fires && !self.announce(*id, now, false) && iteration > known {
                self.emit("repeatEvent", *id, &format!(",{iteration}"));
            }
        }
    }

    /// Whether another interval is active.
    fn announce(&mut self, id: NodeId, now: f64, only_ends: bool) -> bool {
        let Some(it) = self.smil.elements.get_mut(&id) else {
            return false;
        };
        let current = it.current(now).filter(|_| !only_ends);
        let before = core::mem::replace(&mut it.active, current);
        let differs = before.map(|it| it[BEGIN]) != current.map(|it| it[BEGIN]);
        for (kind, interval) in [("endEvent", before), ("beginEvent", current)] {
            if differs && interval.is_some() {
                self.emit(kind, id, ",0");
            }
        }
        differs
    }

    fn advance(&mut self, svg: NodeId, from: f64, to: f64, fires: bool) {
        let (members, mut now) = (self.members(svg), from);
        for _ in 0..200_000 / (members.len() + 1) {
            self.settle_intervals(&members, now, fires);
            self.settle_intervals(&members, now, fires);
            now = members
                .iter()
                .map(|it| self.smil.elements[it].next_change(now))
                .fold(INDEFINITE, f64::min);
            if now > to {
                break;
            }
        }
        self.settle_intervals(&members, to, fires);
        members
            .iter()
            .for_each(|it| _ = self.announce(*it, to, false));
        self.container(svg).time = to;
    }

    fn adopt_animations(&mut self) {
        for id in core::mem::take(&mut self.smil.stale) {
            let is_svg = |it: &NodeId| {
                self.tree
                    .element(*it)
                    .is_some_and(|it| it.tag == name!("svg") && it.namespace == Namespace::Svg)
            };
            let (Some(svg), Some(element)) = (
                self.tree
                    .flat_ancestors(id)
                    .find(is_svg)
                    .filter(|_| self.tree[id].scope != 0),
                self.tree.element(id),
            ) else {
                self.smil.elements.remove(&id);
                continue;
            };
            let it = self.smil.elements.entry(id).or_default();
            it.container = svg;
            it.parse(element);
            if it.interval.is_some_and(|[begin, _]| {
                it.instances[BEGIN].iter().all(|it| it.0 != begin)
                    && it.conditions[BEGIN]
                        .iter()
                        .all(|it| matches!(it, Condition::Offset(_)))
            }) {
                let now = self.smil.containers.get(&svg).map_or(0.0, |it| it.time);
                it.previous = it.current(now).map(|it| [it[BEGIN], now]).or(it.previous);
                it.interval = None;
            }
            let (now, members) = (self.container(svg).time, self.members(svg));
            members
                .iter()
                .for_each(|it| self.notify(&members, *it, None, now));
        }
    }

    pub(crate) fn update_smil(&mut self) {
        self.smil.needs_update = false;
        self.adopt_animations();
        let (now, mut contributing) = (self.smil.now, Vec::new());
        let containers: Vec<_> = self
            .smil
            .containers
            .keys()
            .copied()
            .filter(|_| self.smil.has_started)
            .collect();
        for svg in containers {
            let it = self.container(svg);
            let (from, elapsed) = (
                it.time,
                it.since.as_mut().map_or(0.0, |it| {
                    (now - core::mem::replace(it, now)).max(0.0) / 1000.0
                }),
            );
            self.advance(svg, from, from + elapsed, true);
            let progress = |id: NodeId| {
                self.smil.elements[&id].progress(from + elapsed).map(
                    |(begin, fraction, iteration)| {
                        (
                            begin,
                            Progress {
                                id,
                                fraction,
                                iteration,
                            },
                        )
                    },
                )
            };
            contributing.extend(self.members(svg).into_iter().filter_map(progress));
        }
        contributing.sort_by(|a, b| a.0.total_cmp(&b.0));
        self.apply_smil(contributing.into_iter().map(|it| it.1));
    }

    pub(crate) fn start_smil(&mut self) {
        if !core::mem::replace(&mut self.smil.has_started, true) {
            let now = self.smil.now;
            self.smil
                .containers
                .values_mut()
                .filter(|it| !it.is_paused)
                .for_each(|it| it.since = Some(now));
            self.smil.needs_update = !self.smil.is_empty();
        }
    }

    pub(crate) fn smil_time(&mut self, svg: NodeId) -> f64 {
        let now = self.smil.now;
        let it = self.container(svg);
        it.time
            + it.since
                .map_or(0.0, |since| (now - since).max(0.0) / 1000.0)
    }

    pub(crate) fn seek_smil(&mut self, svg: NodeId, to: f64) {
        self.adopt_animations();
        let (now, has_started) = (self.smil.now, self.smil.has_started);
        let it = self.container(svg);
        (it.time, it.since) = (to, it.since.map(|_| now));
        for it in self
            .smil
            .elements
            .values_mut()
            .filter(|it| it.container == svg)
        {
            (it.interval, it.previous, it.iteration) = (None, None, 0);
            it.instances
                .iter_mut()
                .for_each(|it| it.retain(|it| !matches!(it.1, Origin::Other(..))));
        }
        let (events, active): (_, Vec<_>) = (
            self.events.len(),
            self.smil
                .elements
                .iter()
                .map(|it| (*it.0, it.1.active))
                .collect(),
        );
        self.advance(svg, 0.0, to, false);
        if !has_started {
            self.events.truncate(events);
            active.into_iter().for_each(|(id, active)| {
                self.smil
                    .elements
                    .get_mut(&id)
                    .into_iter()
                    .for_each(|it| it.active = active)
            });
        }
        self.update_smil();
    }

    pub(crate) fn pause_smil(&mut self, svg: NodeId, pauses: bool) {
        self.update_smil();
        let since = (self.smil.has_started && !pauses).then_some(self.smil.now);
        let it = self.container(svg);
        (it.is_paused, it.since) = (pauses, since);
    }

    pub(crate) fn is_smil_paused(&mut self, svg: NodeId) -> bool {
        self.container(svg).is_paused
    }

    pub(crate) fn add_smil_instance(
        &mut self,
        id: NodeId,
        ends: bool,
        offset: f64,
        is_for_event: bool,
    ) {
        self.adopt_animations();
        let Some(svg) = self.smil.elements.get(&id).map(|it| it.container) else {
            return;
        };
        let now = self.smil_time(svg);
        if let Some(it) = self
            .smil
            .elements
            .get_mut(&id)
            .filter(|it| !(is_for_event && ends && it.current(now).is_none()))
        {
            it.add(usize::from(ends), now + offset, Origin::Script, now);
        }
        self.smil.needs_update = true;
    }

    /// `getStartTime`, `getCurrentTime` and `getSimpleDuration`
    pub(crate) fn smil_times(&mut self, id: NodeId) -> [f64; 3] {
        if self.smil.needs_update {
            self.update_smil();
        }
        let Some(it) = self.smil.elements.get(&id) else {
            return [INDEFINITE, 0.0, INDEFINITE];
        };
        let (begin, duration, svg) = (
            it.interval.map_or(INDEFINITE, |it| it[BEGIN]),
            it.simple_duration(),
            it.container,
        );
        [begin, self.smil_time(svg), duration]
    }
}
