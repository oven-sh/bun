use super::annual::AnnualRule;

/// More than any offset from UTC.
pub(super) const SECONDS_PER_DAY: i64 = 86_400;
/// Further from the epoch than any time that a script can name.
const LIMIT: i64 = 1 << 46;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Offset {
    /// What local time is ahead of UTC. Less than a day.
    pub(crate) seconds: i32,
    pub(crate) is_daylight: bool,
}

impl Offset {
    pub(crate) const UTC: Offset = Offset {
        seconds: 0,
        is_daylight: false,
    };
}

/// The times from `start` up to `end`, which share an offset. The next span can have the same one.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Span {
    pub(crate) start: i64,
    pub(crate) end: i64,
    pub(crate) offset: Offset,
}

/// Which offset applies to a local time that a transition skips or repeats.
#[derive(Clone, Copy)]
pub(crate) enum Side {
    Before,
    After,
}

impl Side {
    /// What to add to the instant of a transition to get the first local time that has the new offset.
    #[inline]
    pub(super) fn local_shift(self, one: Offset, other: Offset) -> i64 {
        i64::from(match self {
            Side::Before => one.seconds.max(other.seconds),
            Side::After => one.seconds.min(other.seconds),
        })
    }
}

/// The offsets in seconds that a local time can be read with. If they differ, it is inside a transition: skipped if `after`
/// is the greater, and repeated otherwise.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct LocalOffsets {
    pub before: i32,
    pub after: i32,
}

#[derive(Clone, Copy)]
pub(super) struct Transition {
    pub(super) time: i64,
    pub(super) offset: Offset,
}

/// The offsets of a zone through all of time. Times are seconds since the epoch.
pub struct ZoneRules {
    pub(super) initial: Offset,
    /// In order of time.
    pub(super) history: Vec<Transition>,
    pub(super) annual: Option<AnnualRule>,
}

impl ZoneRules {
    pub(super) const UTC: &ZoneRules = &ZoneRules {
        initial: Offset::UTC,
        history: Vec::new(),
        annual: None,
    };

    /// What local time is ahead of UTC at an instant, in seconds.
    pub fn offset_at(&self, time: i64) -> i32 {
        self.span_at(time).offset.seconds
    }

    pub fn offsets_at_local(&self, local_time: i64) -> LocalOffsets {
        LocalOffsets {
            before: self.span_at_local(local_time, Side::Before).offset.seconds,
            after: self.span_at_local(local_time, Side::After).offset.seconds,
        }
    }

    /// The first instant after `time` at which the offset changes.
    pub fn next_transition(&self, time: i64) -> Option<i64> {
        let mut span = self.span_at(time);
        let offset = span.offset.seconds;
        while span.end < LIMIT {
            span = self.span_at(span.end);
            if span.offset.seconds != offset {
                return Some(span.start);
            }
        }
        None
    }

    /// The last instant before `time` at which the offset changes.
    pub fn previous_transition(&self, time: i64) -> Option<i64> {
        let mut span = self.span_at(time.saturating_sub(1));
        let offset = span.offset.seconds;
        while span.start > -LIMIT {
            span = self.span_at(span.start - 1);
            if span.offset.seconds != offset {
                return Some(span.end);
            }
        }
        None
    }

    pub(crate) fn span_at(&self, time: i64) -> Span {
        let time = time.clamp(-LIMIT, LIMIT);
        match &self.annual {
            Some(annual) if time >= annual.start => annual.span_at(time),
            _ => {
                let passed = self.history.partition_point(|it| it.time <= time);
                Span {
                    start: self.history[..passed].last().map_or(i64::MIN, |it| it.time),
                    end: (self.history.get(passed))
                        .map_or(i64::MAX, |it| it.time)
                        .min(self.end_of_history()),
                    offset: self.offset_after(passed),
                }
            }
        }
    }

    /// The span is in local time too.
    pub(crate) fn span_at_local(&self, local_time: i64, side: Side) -> Span {
        let local_time = local_time.clamp(-LIMIT, LIMIT);
        if let Some(annual) = &self.annual
            && local_time >= annual.start
        {
            return annual.span_at_local(local_time, side);
        }
        let mut passed =
            (self.history).partition_point(|it| it.time - SECONDS_PER_DAY <= local_time);
        let mut end = (self.history.get(passed))
            .map_or(i64::MAX, |it| it.time - SECONDS_PER_DAY)
            .min(self.end_of_history());
        while let Some(transition) = self.history[..passed].last() {
            let start = transition.time
                + side.local_shift(self.offset_after(passed - 1), transition.offset);
            if start <= local_time {
                let offset = transition.offset;
                return Span { start, end, offset };
            }
            end = end.min(start);
            passed -= 1;
        }
        Span {
            start: i64::MIN,
            end,
            offset: self.initial,
        }
    }

    fn offset_after(&self, transitions: usize) -> Offset {
        self.history[..transitions]
            .last()
            .map_or(self.initial, |it| it.offset)
    }

    fn end_of_history(&self) -> i64 {
        self.annual.as_ref().map_or(i64::MAX, |it| it.start)
    }
}
