use core::cell::Cell;
use core::pin::{Pin, pin};

use bun_core::Timespec;
use bun_event_loop::EventLoopTimer::{
    Clock, ImmediateTask, OwnedTimer, RefCountedTimer, Tag, TimerHeaps, TimerRef,
};
use bun_event_loop::impl_timer_owner;
use bun_ptr::{AliasableBox, RefCount, RefPtr};

thread_local! {
    static HEAPS: Cell<*const TimerHeaps> = const { Cell::new(core::ptr::null()) };
}

#[unsafe(no_mangle)]
fn __bun_timer_heaps() -> &'static TimerHeaps {
    // SAFETY: only an armed timer asks, and none is armed once the heaps of `heaps()` are dropped.
    unsafe { &*HEAPS.get() }
}

fn heaps() -> AliasableBox<TimerHeaps> {
    // SAFETY: `HEAPS` is set before it is returned.
    let heaps = AliasableBox::new(unsafe { TimerHeaps::init() });
    HEAPS.set(heaps.as_ptr());
    heaps
}

fn at(sec: i64) -> Timespec {
    Timespec { sec, nsec: 0 }
}

struct Pinned {
    id: Box<u32>,
    timer: OwnedTimer<{ Tag::AbortSignalTimeout }>,
}
impl_timer_owner!(Pinned; timer: OwnedTimer<AbortSignalTimeout>);

impl Pinned {
    fn new(id: u32) -> Self {
        Self {
            id: Box::new(id),
            timer: OwnedTimer::init_paused(),
        }
    }
}

#[derive(bun_ptr::RefCounted)]
struct Counted {
    id: Box<u32>,
    ref_count: RefCount,
    timer: RefCountedTimer<{ Tag::TimeoutObject }>,
}
impl_timer_owner!(Counted; timer: RefCountedTimer<TimeoutObject>);

impl Counted {
    fn new(id: u32) -> RefPtr<Self> {
        RefPtr::new(Self {
            id: Box::new(id),
            ref_count: RefCount::init(),
            timer: RefCountedTimer::init_paused(),
        })
    }
}

#[derive(bun_ptr::RefCounted)]
struct Immediate {
    id: Box<u32>,
    ref_count: RefCount,
    timer: RefCountedTimer<{ Tag::ImmediateObject }>,
}
impl_timer_owner!(Immediate; timer: RefCountedTimer<ImmediateObject>);

struct ArmsInDrop {
    timer: OwnedTimer<{ Tag::ViWait }>,
}
impl_timer_owner!(ArmsInDrop, drop = Self::arm; timer: OwnedTimer<ViWait>);

impl ArmsInDrop {
    fn arm(&self) {
        __bun_timer_heaps().update(self.timer.timer_ref(), &at(1), Clock::Real);
    }
}

fn pop_ids(heaps: &TimerHeaps) -> Vec<u32> {
    core::iter::from_fn(|| heaps.real().delete_min())
        .map(|timer| match timer.tag() {
            Tag::TimeoutObject => *timer.into_owner_ref::<_, Counted>().id,
            // SAFETY: just popped.
            _ => unsafe { *(*timer.into_owner_ptr::<_, Pinned>()).id },
        })
        .collect()
}

#[test]
fn dropping_an_owner_unlinks_its_timer() {
    let heaps = heaps();
    let mut owners: Vec<_> = (0..8)
        .map(|id| AliasableBox::new(Pinned::new(id)))
        .collect();
    for owner in &owners {
        let deadline = at(i64::from(*owner.id * 5 % 8));
        heaps.update(
            TimerRef::from_pin(owner.as_pin_ref()),
            &deadline,
            Clock::Real,
        );
    }
    {
        let on_stack = pin!(Pinned::new(8));
        heaps.update(TimerRef::from_pin(on_stack.as_ref()), &at(-1), Clock::Real);
        assert_eq!(heaps.real().first_deadline(), Some(at(-1)));
    }
    owners.retain(|owner| *owner.id % 3 != 0);
    assert_eq!(heaps.real().count(), 5);
    assert_eq!(pop_ids(&heaps), [5, 2, 7, 4, 1]);
    assert!(owners.iter().all(|owner| !owner.timer.is_active()));
}

#[test]
fn heap_holds_the_last_ref() {
    let heaps = heaps();
    for id in 0..6 {
        heaps.update(
            TimerRef::from_ref_ptr(Counted::new(id)),
            &at(1),
            Clock::Real,
        );
    }
    for owner in heaps.owner_refs::<_, Counted>() {
        match *owner.id {
            1 | 4 => drop(owner.timer.disarm().unwrap()),
            0 => {
                let heap_ref = owner.timer.disarm().unwrap();
                heaps.update(TimerRef::from_ref_ptr(heap_ref), &at(1), Clock::Real);
            }
            _ => {}
        }
    }
    assert_eq!(pop_ids(&heaps), [2, 3, 5, 0]);
}

#[test]
fn immediate_task_round_trips() {
    let task = ImmediateTask::new(RefPtr::new(Immediate {
        id: Box::new(9),
        ref_count: RefCount::init(),
        timer: RefCountedTimer::init_paused(),
    }));
    assert_eq!(*task.into_owner_ref().id, 9);
}

#[test]
fn disarming_a_popped_timer_leaves_the_heap_alone() {
    let heaps = heaps();
    let (first, second) = (pin!(Pinned::new(1)), Counted::new(2));
    heaps.update(TimerRef::from_pin(first.as_ref()), &at(1), Clock::Real);
    heaps.update(TimerRef::from_ref_ptr(second.clone()), &at(2), Clock::Real);
    heaps.update(TimerRef::from_ref_ptr(Counted::new(3)), &at(3), Clock::Real);
    let _ = heaps.real().delete_min();
    first.timer.disarm();
    let popped = heaps.real().delete_min().unwrap();
    assert!(second.timer.disarm().is_none());
    drop(popped.into_owner_ref::<_, Counted>());
    assert_eq!(pop_ids(&heaps), [3]);
}

#[test]
fn update_moves_a_timer_between_the_heaps() {
    let heaps = heaps();
    let owner = pin!(Pinned::new(1));
    heaps.update(TimerRef::from_pin(owner.as_ref()), &at(1), Clock::Fake);
    assert!(heaps.real().is_empty());
    assert!(owner.timer.clock() == Some(Clock::Fake));
    heaps.update(owner.timer.timer_ref(), &at(2), Clock::Real);
    assert!(heaps.fake().is_empty());
    assert!(owner.timer.clock() == Some(Clock::Real));
    assert_eq!(pop_ids(&heaps), [1]);
}

#[test]
fn timer_armed_through_a_mutable_borrow_stays_valid() {
    let heaps = heaps();
    let mut owner = Box::new(Pinned::new(1));
    // SAFETY: it stays in the box.
    OwnedTimer::mark_pinned(unsafe { Pin::new_unchecked(&*owner) });
    let other = pin!(Pinned::new(5));
    fn change(owner: &mut Pinned, heaps: &TimerHeaps, other: Pin<&Pinned>) {
        heaps.update(owner.timer.timer_ref(), &at(2), Clock::Real);
        heaps.update(TimerRef::from_pin(other), &at(1), Clock::Real);
        *owner.id += 1;
    }
    change(&mut owner, &heaps, other.as_ref());
    change(&mut owner, &heaps, other.as_ref());
    assert_eq!(pop_ids(&heaps), [5, 3]);
    change(&mut owner, &heaps, other.as_ref());
    other.timer.disarm();
    let popped: *mut Pinned = heaps.real().delete_min().unwrap().into_owner_ptr();
    // SAFETY: `owner` is alive and not borrowed.
    unsafe { &mut *popped }.id = Box::new(7);
    assert_eq!(*owner.id, 7);
}

#[test]
fn timer_armed_in_drop_is_unlinked() {
    let heaps = heaps();
    let owner = AliasableBox::new(ArmsInDrop {
        timer: OwnedTimer::init_paused(),
    });
    OwnedTimer::mark_pinned(owner.as_pin_ref());
    drop(owner);
    assert!(heaps.real().is_empty());
}

#[test]
fn owner_outlives_the_heaps() {
    let owner = pin!(Pinned::new(1));
    let heaps = heaps();
    heaps.update(TimerRef::from_pin(owner.as_ref()), &at(1), Clock::Real);
    drop(heaps);
    assert!(!owner.timer.is_active());
}

#[test]
#[should_panic(expected = "the owner of the timer is not pinned")]
fn timer_ref_panics_before_mark_pinned() {
    let _ = Pinned::new(1).timer.timer_ref();
}

#[test]
#[should_panic(expected = "this thread already has TimerHeaps")]
fn second_heaps_on_a_thread_panics() {
    let _heaps = (heaps(), heaps());
}
