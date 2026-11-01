use core::future::Future;
use core::pin::Pin;
use core::task::{Context, Poll};

pub enum Either<A, B> {
    Left(A),
    Right(B),
}

/// Whichever finishes first; `left` if both have. The other is dropped, which cancels it.
pub fn race<A: Future, B: Future>(left: A, right: B) -> Race<A, B> {
    Race { left, right }
}

#[must_use = "futures do nothing unless awaited"]
pub struct Race<A, B> {
    left: A,
    right: B,
}

impl<A: Future, B: Future> Future for Race<A, B> {
    type Output = Either<A::Output, B::Output>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        // SAFETY: both fields are structurally pinned: never moved out of, and `Race` has no `Drop`.
        let (left, right) = unsafe {
            let this = self.get_unchecked_mut();
            (
                Pin::new_unchecked(&mut this.left),
                Pin::new_unchecked(&mut this.right),
            )
        };
        if let Poll::Ready(value) = left.poll(cx) {
            return Poll::Ready(Either::Left(value));
        }
        right.poll(cx).map(Either::Right)
    }
}
