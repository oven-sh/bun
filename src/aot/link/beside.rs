// Calls each once, at the same time: the first on one other thread, the second on the calling thread.
pub type Beside<'a> = &'a (dyn Fn(&mut (dyn FnMut() + Send), &mut dyn FnMut()) + Sync);

pub(crate) fn run_one_after_the_other(first: &mut (dyn FnMut() + Send), second: &mut dyn FnMut()) {
    first();
    second();
}

pub(crate) fn run_beside<A: Send, B>(
    beside: Beside<'_>,
    on_another_thread: impl FnOnce() -> A + Send,
    on_this_thread: impl FnOnce() -> B,
) -> (A, B) {
    let (mut first, mut second) = (Some(on_another_thread), Some(on_this_thread));
    let (mut first_result, mut second_result) = (None, None);
    beside(
        &mut || first_result = first.take().map(|run| run()),
        &mut || second_result = second.take().map(|run| run()),
    );
    (
        first_result.expect("the runner calls both"),
        second_result.expect("the runner calls both"),
    )
}
