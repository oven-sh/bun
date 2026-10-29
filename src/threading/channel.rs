// This file contains code derived from the following source:
//   https://gist.github.com/kprotty/0d2dc3da4840341d6ff361b27bdac7dc#file-sync2-zig

use bun_collections::LinearFifo;
use bun_collections::linear_fifo::{DynamicBuffer, LinearFifoBuffer, StaticBuffer};

use crate::Condition;
use crate::Guarded;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelError {
    #[error("Closed")]
    Closed,
    #[error("OutOfMemory")]
    OutOfMemory,
}

bun_core::oom_from_alloc!(ChannelError);

struct State<T, B: LinearFifoBuffer<T>> {
    buffer: LinearFifo<T, B>,
    is_closed: bool,
}

// The buffer strategy is a `LinearFifoBuffer<T>` trait param
// (`Channel<T, B: LinearFifoBuffer<T>>`) with per-buffer inherent constructors
// below.
pub struct Channel<T, B: LinearFifoBuffer<T> = DynamicBuffer<T>> {
    state: Guarded<State<T, B>>,
    putters: Condition,
    getters: Condition,
}

// Rust cannot dispatch a single `init` ident to different signatures based on
// a type-level discriminant. Callers pick the matching constructor directly.

impl<T: Copy, const N: usize> Channel<T, StaticBuffer<T, N>> {
    #[inline]
    pub fn init_static() -> Self {
        Self::with_buffer(LinearFifo::<T, StaticBuffer<T, N>>::init())
    }
}

// `T: Copy` because `LinearFifo::write`/`read` are slice-copy based. All
// in-tree channel payloads are POD; revisit if a non-`Copy` T appears.
impl<T: Copy, B: LinearFifoBuffer<T>> Channel<T, B> {
    fn with_buffer(buffer: LinearFifo<T, B>) -> Self {
        Self {
            state: Guarded::new(State {
                buffer,
                is_closed: false,
            }),
            putters: Condition::default(),
            getters: Condition::default(),
        }
    }

    pub fn write_item(&self, item: T) -> Result<(), ChannelError> {
        self.write_all(core::slice::from_ref(&item))
    }

    pub fn read_item(&self) -> Result<T, ChannelError> {
        let mut state = self.state.lock();

        loop {
            if let Some(item) = state.buffer.read_item() {
                self.putters.signal();
                return Ok(item);
            }
            if state.is_closed {
                return Err(ChannelError::Closed);
            }
            self.getters.wait_guarded(&mut state);
        }
    }

    pub(crate) fn write_all(&self, items: &[T]) -> Result<(), ChannelError> {
        let n = self.write_items(items, true)?;
        debug_assert!(n == items.len());
        Ok(())
    }

    fn write_items(&self, items: &[T], should_block: bool) -> Result<usize, ChannelError> {
        let mut state = self.state.lock();

        let mut pushed: usize = 0;
        while pushed < items.len() {
            let did_push = 'blk: {
                if state.is_closed {
                    return Err(ChannelError::Closed);
                }
                match state.buffer.write(items) {
                    Ok(()) => {}
                    Err(err) => {
                        if B::DYNAMIC {
                            return Err(err.into());
                        }
                        break 'blk false;
                    }
                }
                self.getters.signal();
                break 'blk true;
            };

            if did_push {
                pushed += 1;
            } else if should_block {
                self.putters.wait_guarded(&mut state);
            } else {
                break;
            }
        }

        Ok(pushed)
    }
}
