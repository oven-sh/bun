use crate::statistics::StepClock;
use core::time::Duration;
use std::time::Instant;

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

fn run_timed<R>(run: impl FnOnce() -> R) -> (R, Duration) {
    let began = Instant::now();
    let result = run();
    (result, began.elapsed())
}

pub(crate) fn run_steps_beside<A: Send, B>(
    beside: Beside<'_>,
    steps: &mut StepClock,
    names: [&str; 2],
    on_another_thread: impl FnOnce() -> A + Send,
    on_this_thread: impl FnOnce() -> B,
) -> (A, B) {
    let ((first, first_time), (second, second_time)) = run_beside(
        beside,
        move || run_timed(on_another_thread),
        move || run_timed(on_this_thread),
    );
    if steps.logs() {
        let [first_time, second_time] =
            [first_time, second_time].map(|time| time.as_secs_f64() * 1000.0);
        steps.end(&format!(
            "{} ({first_time:.3} ms) beside {} ({second_time:.3} ms)",
            names[0], names[1]
        ));
    }
    (first, second)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::print_program;
    use crate::link::LinkInput;
    use crate::link::testing::{forward, link, with_lowered_units};
    use std::thread::ThreadId;

    const PROGRAM: [(&str, &str); 2] = [
        (
            "main.ts",
            r#"import { area } from "./shape.ts";

export const total: number = area({ width: 2, height: 3 });
export const label = "total";
"#,
        ),
        (
            "shape.ts",
            r#"export interface Box {
  width: number;
  height: number;
}

export function area(box: Box): number {
  return box.width * box.height;
}

function unused(): string {
  return "unused";
}
"#,
        ),
    ];

    fn run_second_first(first: &mut (dyn FnMut() + Send), second: &mut dyn FnMut()) {
        second();
        first();
    }

    fn run_on_two_threads(first: &mut (dyn FnMut() + Send), second: &mut dyn FnMut()) {
        std::thread::scope(|scope| {
            scope.spawn(first);
            second();
        });
    }

    fn current_thread() -> ThreadId {
        std::thread::current().id()
    }

    fn print_linked_with(beside: Beside<'_>) -> String {
        with_lowered_units(&PROGRAM, |units, projects| {
            let linked = link(LinkInput {
                units,
                projects: *projects,
                in_parallel: &forward,
                beside,
            });
            print_program(&linked.expect("the program links").program)
        })
    }

    #[test]
    fn link_lists_a_module_for_each_module_record() {
        let runners: [Beside<'_>; 2] = [&run_one_after_the_other, &run_on_two_threads];
        for beside in runners {
            with_lowered_units(&PROGRAM, |units, projects| {
                let input = LinkInput {
                    units,
                    projects: *projects,
                    in_parallel: &forward,
                    beside,
                };
                let linked = link(input).expect("the program links");
                assert_eq!(linked.modules.len(), linked.program.modules.len());
            });
        }
    }

    #[test]
    fn both_results_are_returned() {
        let runners: [Beside<'_>; 3] = [
            &run_one_after_the_other,
            &run_second_first,
            &run_on_two_threads,
        ];
        for beside in runners {
            let text = vec![b'a'];
            assert_eq!(run_beside(beside, move || text, || 2), (vec![b'a'], 2));
        }
    }

    #[test]
    fn second_runs_on_calling_thread() {
        let (other, own) = run_beside(&run_on_two_threads, current_thread, current_thread);
        assert_eq!(own, current_thread());
        assert_ne!(other, own);
    }

    #[test]
    fn program_does_not_depend_on_which_runs_first() {
        let program = print_linked_with(&run_one_after_the_other);
        assert_eq!(program, print_linked_with(&run_second_first));
        assert_eq!(program, print_linked_with(&run_on_two_threads));
    }
}
