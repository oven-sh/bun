use bun_io::StreamBuffer;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_ptr::JsCell;

/// Unsent bytes of node:net writes. A drain moves no bytes and an empty queue holds no allocation.
/// Every edit goes through `append`, `consume` or `release`.
#[derive(Default)]
pub(crate) struct PendingWrites(JsCell<StreamBuffer>);

impl PendingWrites {
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.0.get().size()
    }

    #[inline]
    pub(crate) fn slice(&self) -> &[u8] {
        self.0.get().slice()
    }

    /// The allocation, sent prefix included.
    #[inline]
    pub(crate) fn capacity(&self) -> usize {
        self.0.get().memory_cost()
    }

    #[inline]
    pub(crate) fn append(&self, bytes: &[u8]) {
        self.0
            .with_mut(|buffer| bun_core::handle_oom(buffer.write(bytes)));
    }

    /// The socket took `n` bytes. `n` can exceed `len()`: one writev sends the queue and the chunk behind it.
    #[inline]
    pub(crate) fn consume(&self, n: usize) {
        if n >= self.len() {
            self.0.set(StreamBuffer::default());
        } else {
            self.0.with_mut(|buffer| buffer.wrote(n));
        }
    }

    /// Drops the bytes that the socket did not take.
    #[inline]
    pub(crate) fn release(&self) {
        self.0.set(StreamBuffer::default());
    }
}

/// The byte at `position` of the stream that `replay_probe` appends.
fn probe_byte(position: usize) -> u8 {
    (position ^ (position >> 8) ^ (position >> 16)) as u8
}

/// `bun:internal-for-testing`: replays appends (`n >= 0`) and drains (`n < 0`) on a fresh queue.
pub(crate) fn replay_probe(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let mut schedule = frame.argument(0).array_iterator(global)?;

    let queue = PendingWrites::default();
    let mut appended: usize = 0;
    let mut sent: usize = 0;
    let mut intact = true;
    let mut moves_on_drain: usize = 0;
    let mut moves_on_append: usize = 0;
    let mut bytes_moved: usize = 0;
    let mut peak_capacity: usize = 0;

    while let Some(entry) = schedule.next()? {
        let n = entry.coerce_to_i32(global)?;
        let count = n.unsigned_abs() as usize;
        let unsent_before = queue.len();
        let front_before = queue.slice().as_ptr();

        let advanced = if n >= 0 {
            let bytes: Vec<u8> = (appended..appended + count).map(probe_byte).collect();
            queue.append(&bytes);
            appended += bytes.len();
            0
        } else {
            let take = count.min(unsent_before);
            intact &= queue.slice()[..take]
                .iter()
                .zip(sent..)
                .all(|(byte, position)| *byte == probe_byte(position));
            sent += take;
            queue.consume(count);
            take
        };

        let kept = unsent_before - advanced;
        if kept > 0 && queue.slice().as_ptr() != front_before.wrapping_add(advanced) {
            if n >= 0 {
                moves_on_append += 1;
            } else {
                moves_on_drain += 1;
            }
            bytes_moved += kept;
        }
        intact &= queue.len() == appended - sent;
        peak_capacity = peak_capacity.max(queue.capacity());
    }

    let result = JSValue::create_empty_object(global, 8);
    let number = |value: usize| JSValue::js_number(value as f64);
    result.put(global, b"intact", JSValue::from(intact));
    result.put(global, b"sent", number(sent));
    result.put(global, b"unsent", number(queue.len()));
    result.put(global, b"movesOnDrain", number(moves_on_drain));
    result.put(global, b"movesOnAppend", number(moves_on_append));
    result.put(global, b"bytesMoved", number(bytes_moved));
    result.put(global, b"capacity", number(queue.capacity()));
    result.put(global, b"peakCapacity", number(peak_capacity));
    Ok(result)
}
