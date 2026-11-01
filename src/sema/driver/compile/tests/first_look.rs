use super::support::{DEPENDENCY_MANIFEST, check, with_program};
use bun_sema::check::aot::{BuiltinTypeSymbols, NamedValue, NamedValues, QueryInputs};
use bun_sema::hir::{ExprId, ExprKind};
use bun_sema::program::{FileId, FileRole};
use std::sync::Mutex;

struct NoNamedValues;

impl NamedValues for NoNamedValues {
    fn find_named_value(&self, _: FileId, _: ExprId) -> Option<NamedValue> {
        None
    }
}

// As `stat(path).catch((e: unknown) => (isMissing(e) ? undefined : Promise.reject(e)))` handed to a generic function.
const BOXES: &str = "export interface Box<T> {
    value: T;
    or<R = never>(handle: (reason: unknown) => R | Box<R>): Box<T | R>;
}
declare function make(): Box<number>;
declare function refuse<T = never>(reason?: unknown): Box<T>;
declare function bounded<T>(work: Box<T>): T;
export const kept = bounded(make().or((reason: unknown) => (reason ? undefined : refuse(reason))));
";

/// The type of each call of the dependency, asked for in the order of their positions: the outermost first.
fn ask_for_calls(threads: usize) -> Vec<(String, String)> {
    let files = [
        ("node_modules/dep/package.json", DEPENDENCY_MANIFEST),
        ("node_modules/dep/index.ts", BOXES),
        (
            "main.ts",
            "import { kept } from \"dep\";\nexport const own = kept;\n",
        ),
    ];
    with_program(&files, &["./main.ts"], threads, |program| {
        let all = program.files();
        let roles: Vec<FileRole> = (0..all.modules.len() as u32)
            .map(|file| all.role(FileId(file)))
            .collect();
        let inputs = QueryInputs {
            roles: &roles,
            checked_elsewhere: &[],
            builtin_types: &BuiltinTypeSymbols::compute(all, &[], Box::new(|| &[])),
            named_values: &NoNamedValues,
            max_inference_nodes: 0,
            limits: Default::default(),
        };
        let dep = program.file("node_modules/dep/index.ts");
        let answers = Mutex::new(Vec::new());
        let build = check(program, &|checker, file| {
            if file != dep {
                return;
            }
            checker.with_queries(file, &inputs, |queries| {
                let mut calls: Vec<(u32, u32, ExprId)> = (queries.hir().exprs.iter().enumerate())
                    .filter(|(_, expression)| matches!(expression.kind, ExprKind::Call(_)))
                    .map(|(index, it)| (it.pos, u32::MAX - it.end, ExprId(index as u32)))
                    .collect();
                calls.sort();
                let mut texts = Vec::new();
                for (start, end, call) in calls {
                    let ty = queries.expression_type(call).unwrap();
                    let written = &BOXES[start as usize..(u32::MAX - end) as usize];
                    let written = written.split('(').next().unwrap().trim().to_string();
                    texts.push((written, String::from_utf8(queries.type_text(ty)).unwrap()));
                }
                *answers.lock().unwrap() = texts;
            });
        });
        // Another task has checked the file, to decide whether its types are believed.
        assert!(build.roles.is_checked(dep));
        assert!(build.codes().is_empty());
        answers.into_inner().unwrap()
    })
}

/// The check looks at `refuse(reason)` while it infers `R` of the call around the function, where nothing is known of `R`
/// yet: `T` takes its default. With that call resolved, `R` is `undefined`, and a first look then would say `Box<undefined>`.
#[test]
fn call_in_a_function_expression_has_the_type_of_the_check_where_another_task_asks() {
    for threads in [1, 4] {
        let calls = ask_for_calls(threads);
        let expected = [
            ("bounded", "number | undefined"),
            ("make", "Box<number | undefined>"),
            ("make", "Box<number>"),
            ("refuse", "Box<never>"),
        ];
        let calls: Vec<(&str, &str)> = (calls.iter())
            .map(|(written, ty)| (&written[..], &ty[..]))
            .collect();
        assert_eq!(calls, expected, "{threads} threads");
    }
}
