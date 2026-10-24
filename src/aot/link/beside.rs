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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::print_program;
    use crate::link::testing::{forward, link, with_lowered_units};
    use crate::link::{LinkInput, link_while};
    use crate::statistics::LimitValues;
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
            let limits = LimitValues::for_host();
            let linked = link(LinkInput {
                units,
                projects: *projects,
                limits: &limits,
                in_parallel: &forward,
                beside,
            });
            print_program(&linked.expect("the program links").program)
        })
    }

    #[test]
    fn link_calls_meanwhile_once_with_the_keys_of_the_program() {
        let runners: [Beside<'_>; 2] = [&run_one_after_the_other, &run_on_two_threads];
        for beside in runners {
            with_lowered_units(&PROGRAM, |units, projects| {
                let limits = LimitValues::for_host();
                let input = LinkInput {
                    units,
                    projects: *projects,
                    limits: &limits,
                    in_parallel: &forward,
                    beside,
                };
                let mut module_counts = Vec::new();
                let linked = link_while(input, &mut |keys| module_counts.push(keys.modules.len()));
                let linked = linked.expect("the program links");
                assert_eq!(module_counts, [linked.keys.modules.len()]);
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
