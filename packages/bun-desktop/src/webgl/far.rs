//! The context is in another process than the page.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::sync::atomic::Ordering::Relaxed;
use std::time::Instant;

use super::gl::VENDOR;
use super::{CONTEXTS, Context, Link, MAX_CONTEXTS, PATIENCE, Picture, Wanted, Wish, memo, native};
use crate::abi_webgl::Attributes;
use crate::gfx::Pixmap;
use crate::remote::gpu::{self, Line};
use crate::remote::guest;
use crate::sync::Mutex;

const DONE: u32 = 0;
const PICTURE: u32 = 1;
const WANTS_OFFER: u32 = 2;

fn attributes_of(numbers: &[u32]) -> Option<Attributes> {
    let [
        is_webgl2,
        alpha,
        depth,
        stencil,
        antialias,
        premultiplied_alpha,
        preserve_drawing_buffer,
        fail_if_major_performance_caveat,
    ] = <[u32; 8]>::try_from(numbers).ok()?.map(|it| it != 0);
    Some(Attributes {
        is_webgl2,
        alpha,
        depth,
        stencil,
        antialias,
        premultiplied_alpha,
        preserve_drawing_buffer,
        fail_if_major_performance_caveat,
    })
}

/// With what it only loads when it is used. Returns who has made it.
pub fn load_driver() -> Option<String> {
    let load = || {
        let _current = native::enter()?;
        let mut context = Context::new(attributes_of(&[1, 1, 1, 1, 1, 1, 0, 0])?)?;
        context.present(0);
        Some(context.gl.text(VENDOR))
    };
    std::thread::Builder::new()
        .stack_size(8 << 20)
        .spawn(load)
        .ok()?
        .join()
        .ok()?
}

static BUSY: Mutex<Vec<Instant>> = Mutex::new(Vec::new());

struct Busy(Instant);

impl Busy {
    fn new() -> Busy {
        let now = Instant::now();
        BUSY.lock().push(now);
        Busy(now)
    }
}

impl Drop for Busy {
    fn drop(&mut self) {
        let mut all = BUSY.lock();
        all.iter()
            .position(|it| *it == self.0)
            .map(|it| all.swap_remove(it));
    }
}

/// Before the page loses its patience.
pub fn is_hung() -> bool {
    BUSY.lock().iter().any(|it| it.elapsed() > PATIENCE * 2 / 3)
}

fn run_for(page: Line) -> Option<()> {
    let (mut words, mut answer) = (Vec::new(), [Vec::new()]);
    let attributes = attributes_of(&page.receive(&mut words)?.0)?;
    let busy = Busy::new();
    let _current = native::enter()?;
    let mut context = Context::new(attributes)?;
    drop(busy);
    let link = context.link.clone();
    let (page, progress) = (link.page.get_or_init(|| page), &link.progress);
    page.send(
        &[
            progress.extensions as u32,
            (progress.extensions >> 32) as u32,
        ],
        &[],
        &[],
    )?;
    loop {
        page.receive(&mut words)?;
        let (task, busy) = (context.task, Busy::new());
        if !context.run(&words) {
            gpu::report_loss();
            return None;
        }
        drop(busy);
        context.swap_answer(&mut answer[0]);
        words.clear();
        words.shrink_to(1 << 16);
        let (facts, kilobytes) = (context.facts(), (progress.bytes.load(Relaxed) >> 10) as u32);
        let about = [
            DONE,
            facts.active_texture,
            facts.may_capture.into(),
            (context.task == task).into(),
            progress.has_messages.load(Relaxed).into(),
            kilobytes,
        ];
        page.send(&about, &answer, &[])?;
    }
}

pub fn serve_page(page: Line) {
    let run = move || {
        if catch_unwind(AssertUnwindSafe(|| run_for(page))).is_err() {
            gpu::report_loss();
        }
        CONTEXTS.fetch_sub(1, Relaxed);
    };
    if CONTEXTS.fetch_add(1, Relaxed) >= MAX_CONTEXTS
        || std::thread::Builder::new()
            .name("WebGL".into())
            .stack_size(8 << 20)
            .spawn(run)
            .is_err()
    {
        CONTEXTS.fetch_sub(1, Relaxed);
    }
}

pub fn send_picture(
    page: &Line,
    canvas: Option<u32>,
    Picture {
        pixels,
        size,
        is_wide,
    }: &Picture,
) {
    let about = [
        PICTURE,
        canvas.is_some().into(),
        canvas.unwrap_or(0),
        size[0],
        size[1],
        (*is_wide).into(),
    ];
    page.send(&about, &[], pixels.as_ref().map_or(&[], Pixmap::data));
}

pub fn ask_for_offer(page: &Line, wanted: Wanted) -> Option<(Pixmap, [bool; 2])> {
    let [a, b, c, d] = wanted.map(u32::from);
    page.send(&[WANTS_OFFER, a, b, c, d], &[], &[])?;
    let (about, bytes) = page.receive(&mut Vec::new())?;
    let &[width, height, is_premultiplied, is_wide] = &*about else {
        return None;
    };
    Some((
        gpu::pixels(bytes, width, height)?,
        [is_premultiplied != 0, is_wide != 0],
    ))
}

fn relay(link: &Arc<Link>, context: &Line) -> Option<()> {
    const MOST_AT_ONCE: usize = 32;
    let (mut sent, mut answer) = (Vec::new(), Vec::new());
    loop {
        sent.push(link.next()?);
        while sent.len() < MOST_AT_ONCE && !link.shared.lock().waiting.is_empty() {
            sent.push(link.next()?);
        }
        context.send(&[], &sent, &[])?;
        while !sent.is_empty() {
            let (about, bytes) = context.receive(&mut answer)?;
            match *about {
                [
                    DONE,
                    active_texture,
                    may_capture,
                    expects_more,
                    has_messages,
                    kilobytes,
                ] => {
                    link.progress.has_messages.store(has_messages != 0, Relaxed);
                    link.progress
                        .bytes
                        .store((kilobytes as usize) << 10, Relaxed);
                    let facts = memo::Facts {
                        active_texture,
                        may_capture: may_capture != 0,
                    };
                    link.finish(
                        sent.drain(..),
                        |it| std::mem::swap(it, &mut answer),
                        facts,
                        expects_more != 0,
                    );
                    answer.clear();
                    answer.shrink_to(1 << 16);
                }
                [
                    PICTURE,
                    is_frame,
                    canvas,
                    width @ ..=0x1_0000,
                    height @ ..=0x1_0000,
                    is_wide,
                ] => {
                    let picture = Picture {
                        pixels: gpu::pixels(bytes, width, height),
                        size: [width, height],
                        is_wide: is_wide != 0,
                    };
                    if is_frame != 0 {
                        link.present(canvas, picture)
                    } else {
                        link.hand_over(picture)
                    }
                }
                [WANTS_OFFER, a, b, c, d] => {
                    match link.take_offer([a, b, c, d].map(|it| it != 0)) {
                        Some((pixels, [a, b])) => context.send(
                            &[pixels.width(), pixels.height(), a.into(), b.into()],
                            &[],
                            pixels.data(),
                        )?,
                        None => context.send(&[], &[], &[])?,
                    }
                }
                _ => return None,
            }
        }
    }
}

/// In the process of the page.
pub fn pass_on((it, tell): Wish) -> Option<()> {
    let context = guest::connect_to_gpu()?;
    let flags = [
        it.is_webgl2,
        it.alpha,
        it.depth,
        it.stencil,
        it.antialias,
        it.premultiplied_alpha,
        it.preserve_drawing_buffer,
        it.fail_if_major_performance_caveat,
    ];
    context.send(&flags.map(u32::from), &[], &[])?;
    let &[low, high] = &*context.receive(&mut Vec::new())?.0 else {
        return None;
    };
    let link = Link::new(u64::from(high) << 32 | u64::from(low));
    tell.send(link.clone()).ok()?;
    relay(&link, &context);
    link.lose();
    Some(())
}
