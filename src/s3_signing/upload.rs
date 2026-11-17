//! Which request an upload sends next, and what a reply means for it. No I/O and no JS.

use std::collections::VecDeque;
use std::io::Write as _;
use std::mem::{replace, take};
use std::rc::Rc;

use bstr::BStr;
use bun_core::strings;
use bun_http_types::Method::Method;

use crate::MultiPartUploadOptions;
use crate::error::S3Error;

/// A longer string is encoded in pieces, so that it is never held twice.
const TEXT_PIECE: usize = 1 << 20;

/// `Create` was answered with neither an upload id nor an error code.
pub const NO_UPLOAD_ID: S3Error<'static> = S3Error {
    code: b"UnknownError",
    message: b"Failed to initiate multipart upload",
};

pub struct Upload {
    phase: Phase,
    /// No more bytes come.
    ended: bool,
    /// Less than a part.
    tail: Vec<u8>,
    /// Parts that wait for the upload id or for room in the queue.
    waiting: VecDeque<Vec<u8>>,
    part_size: usize,
    queue_size: usize,
    /// What each part starts with, and what `Put`, `Commit` and `Abort` have left together.
    retries: u8,
    accepted: u64,
}

enum Phase {
    /// Nothing was sent.
    Buffering,
    Putting,
    Creating,
    Sending(Sending),
    Committing,
    Finished,
}

struct Sending {
    id: UploadId,
    in_flight: usize,
    /// One for each part that was sent, empty until it is answered.
    etags: Vec<Box<[u8]>>,
}

/// Safe to put in a query string as it is.
#[derive(Clone)]
#[cfg_attr(test, derive(Debug, PartialEq))]
pub struct UploadId(Rc<[u8]>);

#[cfg_attr(test, derive(Debug, PartialEq))]
pub struct Part {
    /// In `Sending::etags`.
    index: u32,
    retries: u8,
    data: Vec<u8>,
}

/// Owns its body, and comes back with its reply: a retry sends the same allocation.
#[cfg_attr(test, derive(Debug, PartialEq))]
pub enum Request {
    Put(Vec<u8>),
    Create,
    Part(UploadId, Part),
    Commit(UploadId, Vec<u8>),
    Abort(UploadId),
}

#[must_use]
#[cfg_attr(test, derive(Debug, PartialEq))]
pub enum Step<'a> {
    Nothing,
    Send(Request),
    /// The store took this many bytes. There may be a [`next_request`](Upload::next_request).
    Drained(usize),
    Succeeded,
    /// Report the error, then send the `Abort`.
    Failed(S3Error<'a>, Option<Request>),
}

impl UploadId {
    const MAX_LEN: usize = 2000;

    fn parse(id: &[u8]) -> Option<Self> {
        let is_safe = |&b: &u8| b.is_ascii_graphic() && !matches!(b, b'&' | b'#' | b'?');
        (!id.is_empty() && id.len() <= Self::MAX_LEN && id.iter().all(is_safe))
            .then(|| Self(id.into()))
    }
}

impl Request {
    pub fn method(&self) -> Method {
        match self {
            Self::Put(_) | Self::Part(..) => Method::PUT,
            Self::Create | Self::Commit(..) => Method::POST,
            Self::Abort(_) => Method::DELETE,
        }
    }

    pub fn body(&self) -> &[u8] {
        match self {
            Self::Put(body) | Self::Commit(_, body) | Self::Part(_, Part { data: body, .. }) => {
                body
            }
            Self::Create | Self::Abort(_) => b"",
        }
    }

    pub fn query(&self) -> Option<String> {
        Some(match self {
            Self::Put(_) => return None,
            Self::Create => "?uploads=".into(),
            Self::Part(id, part) => format!(
                "?partNumber={}&uploadId={}&x-id=UploadPart",
                part.index + 1,
                BStr::new(&id.0)
            ),
            Self::Commit(id, _) | Self::Abort(id) => format!("?uploadId={}", BStr::new(&id.0)),
        })
    }
}

fn commit_body(etags: &[Box<[u8]>]) -> Vec<u8> {
    let mut xml = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">".to_vec();
    for (number, etag) in (1..).zip(etags) {
        let etag = BStr::new(etag);
        let _ = write!(
            xml,
            "<Part><PartNumber>{number}</PartNumber><ETag>{etag}</ETag></Part>"
        );
    }
    xml.extend_from_slice(b"</CompleteMultipartUpload>");
    xml
}

impl Upload {
    pub fn new(options: MultiPartUploadOptions) -> Self {
        let max_queue_size = MultiPartUploadOptions::MAX_QUEUE_SIZE;
        Self {
            phase: Phase::Buffering,
            ended: false,
            tail: Vec::new(),
            waiting: VecDeque::new(),
            part_size: options.part_size as usize,
            queue_size: options.queue_size.min(max_queue_size).into(),
            retries: options.retry,
            accepted: 0,
        }
    }

    fn fits_one_put(&self) -> bool {
        matches!(self.phase, Phase::Buffering) && self.waiting.is_empty()
    }

    /// `tail` has to grow, and twice its capacity is more than a part.
    #[inline]
    fn would_outgrow_a_part(&self, additional: usize) -> bool {
        let capacity = self.tail.capacity();
        additional > capacity - self.tail.len() && capacity > self.part_size / 2
    }

    #[inline]
    fn extend_tail(&mut self, bytes: &[u8]) {
        if self.would_outgrow_a_part(bytes.len()) {
            self.tail.reserve_exact(self.part_size - self.tail.len());
        }
        self.tail.extend_from_slice(bytes);
    }

    /// `true`: it filled a part.
    #[inline]
    pub fn write(&mut self, mut bytes: &[u8]) -> bool {
        debug_assert!(!self.ended);
        self.accepted += bytes.len() as u64;
        let mut filled = false;
        while let Some((last, rest)) = bytes.split_at_checked(self.part_size - self.tail.len()) {
            self.extend_tail(last);
            self.waiting.push_back(take(&mut self.tail));
            (bytes, filled) = (rest, true);
        }
        self.extend_tail(bytes);
        filled
    }

    pub fn write_latin1(&mut self, text: &[u8]) -> bool {
        if strings::is_all_ascii(text) {
            return self.write(text);
        }
        let mut filled = false;
        for piece in text.chunks(TEXT_PIECE) {
            filled |= self.write_encoded(2 * piece.len(), |out| {
                let len = out.len();
                *out = strings::allocate_latin1_into_utf8_with_list(take(out), len, piece);
            });
        }
        filled
    }

    pub fn write_utf16(&mut self, mut text: &[u16]) -> bool {
        let mut filled = false;
        while !text.is_empty() {
            let last = text.get(TEXT_PIECE - 1).copied();
            let len = TEXT_PIECE - usize::from(last.is_some_and(strings::u16_is_lead));
            let piece;
            (piece, text) = text.split_at_checked(len).unwrap_or((text, &[]));
            filled |= self.write_encoded(3 * piece.len(), |out| {
                strings::convert_utf16_to_utf8_append(out, piece);
            });
        }
        filled
    }

    /// `append` adds `max_len` bytes at most.
    fn write_encoded(&mut self, max_len: usize, append: impl FnOnce(&mut Vec<u8>)) -> bool {
        debug_assert!(!self.ended);
        let before = self.tail.len();
        if max_len >= self.part_size - before || self.would_outgrow_a_part(max_len) {
            let mut bytes = Vec::new();
            append(&mut bytes);
            return self.write(&bytes);
        }
        append(&mut self.tail);
        self.accepted += (self.tail.len() - before) as u64;
        false
    }

    pub fn end(&mut self) {
        self.ended = true;
        if !self.fits_one_put() && !self.tail.is_empty() {
            self.waiting.push_back(take(&mut self.tail));
        }
    }

    /// Call it until `None` after a `write` that filled a part, `end` and [`Step::Drained`].
    pub fn next_request(&mut self) -> Option<Request> {
        let (request, phase) = match &mut self.phase {
            Phase::Buffering if !self.waiting.is_empty() => (Request::Create, Phase::Creating),
            Phase::Buffering if self.ended => (Request::Put(take(&mut self.tail)), Phase::Putting),
            Phase::Sending(sending) if sending.in_flight < self.queue_size => {
                if let Some(data) = self.waiting.pop_front() {
                    let part = Part {
                        index: sending.etags.len() as u32,
                        retries: self.retries,
                        data,
                    };
                    sending.in_flight += 1;
                    sending.etags.push(Box::default());
                    return Some(Request::Part(sending.id.clone(), part));
                }
                if !self.ended || sending.in_flight > 0 {
                    return None;
                }
                let body = commit_body(&sending.etags);
                (Request::Commit(sending.id.clone(), body), Phase::Committing)
            }
            _ => return None,
        };
        self.phase = phase;
        Some(request)
    }

    /// `text` is the upload id for `Create` and the ETag for `Part`.
    pub fn on_success(&mut self, request: Request, text: &[u8]) -> Step<'static> {
        match (request, &mut self.phase) {
            // An upload that failed while `Create` was out is open in the store.
            (Request::Create, Phase::Finished) => {
                UploadId::parse(text).map_or(Step::Nothing, |id| Step::Send(Request::Abort(id)))
            }
            (Request::Create, Phase::Creating) => {
                let Some(id) = UploadId::parse(text) else {
                    return self.fail(NO_UPLOAD_ID);
                };
                self.phase = Phase::Sending(Sending {
                    id,
                    in_flight: 0,
                    etags: Vec::new(),
                });
                Step::Drained(0)
            }
            (Request::Part(_, part), Phase::Sending(sending)) => {
                sending.in_flight -= 1;
                if let Some(etag) = sending.etags.get_mut(part.index as usize) {
                    *etag = text.into();
                }
                Step::Drained(part.data.len())
            }
            (Request::Put(_), Phase::Putting) | (Request::Commit(..), Phase::Committing) => {
                self.phase = Phase::Finished;
                Step::Succeeded
            }
            // The upload does not wait for this reply any more.
            _ => Step::Nothing,
        }
    }

    /// `can_commit`: another `Commit` has a chance.
    pub fn on_failure<'a>(
        &mut self,
        mut request: Request,
        error: S3Error<'a>,
        can_commit: bool,
    ) -> Step<'a> {
        let retries = match &mut request {
            Request::Abort(_) => Some(&mut self.retries),
            _ if self.is_finished() => return Step::Nothing,
            Request::Put(_) => Some(&mut self.retries),
            Request::Create => None,
            Request::Part(_, part) => Some(&mut part.retries),
            Request::Commit(..) => can_commit.then_some(&mut self.retries),
        };
        if let Some(retries) = retries.filter(|retries| **retries > 0) {
            *retries -= 1;
            return Step::Send(request);
        }
        match request {
            Request::Commit(id, _) => {
                self.phase = Phase::Finished;
                Step::Failed(error, Some(Request::Abort(id)))
            }
            _ => self.fail(error),
        }
    }

    /// Too late once `Commit` is out: its reply decides.
    pub fn fail<'a>(&mut self, error: S3Error<'a>) -> Step<'a> {
        if let Phase::Committing | Phase::Finished = self.phase {
            return Step::Nothing;
        }
        self.ended = true;
        self.tail = Vec::new();
        self.waiting = VecDeque::new();
        match replace(&mut self.phase, Phase::Finished) {
            Phase::Sending(sending) => Step::Failed(error, Some(Request::Abort(sending.id))),
            _ => Step::Failed(error, None),
        }
    }

    /// Parts that wait or are in flight.
    #[inline]
    fn unanswered(&self) -> usize {
        match &self.phase {
            Phase::Sending(sending) => self.waiting.len() + sending.in_flight,
            _ => self.waiting.len(),
        }
    }

    #[inline]
    pub fn has_backpressure(&self) -> bool {
        self.unanswered() >= self.queue_size
    }

    pub fn is_idle(&self) -> bool {
        self.unanswered() == 0
    }

    #[inline]
    pub fn is_ended(&self) -> bool {
        self.ended
    }

    pub fn is_finished(&self) -> bool {
        matches!(self.phase, Phase::Finished)
    }

    /// Bytes taken, after encoding.
    pub fn accepted(&self) -> u64 {
        self.accepted
    }

    pub fn memory_cost(&self) -> usize {
        self.tail.capacity() + self.waiting.len() * self.part_size
    }
}

#[cfg(test)]
mod tests;
