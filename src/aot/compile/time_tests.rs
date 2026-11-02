use super::testing::{BUNDLED_LIBS, TestProject, default_settings, describe_messages, run_build};
use super::*;
use crate::load::source_provider::WithoutServices;
use std::num::NonZeroU32;

const PROGRAM: [(&str, &str); 2] = [
    (
        "a.ts",
        "import { b } from \"./b\";\nexport const a: number = b + 1;",
    ),
    ("b.ts", "export const b: number = 1;"),
];

const STEPS_OF_LINK_AND_EMIT: [StatisticId; 10] = [
    StatisticId::LinkMergeKeysNanoseconds,
    StatisticId::LinkChooseDefinitionsNanoseconds,
    StatisticId::LinkMarkNanoseconds,
    StatisticId::LinkMergeStringsAndTypesNanoseconds,
    StatisticId::LinkMergePropertyKeysNanoseconds,
    StatisticId::LinkBuildTypeTableNanoseconds,
    StatisticId::LinkMoveDefinitionsNanoseconds,
    StatisticId::LinkNameProgramNanoseconds,
    StatisticId::ReleaseLoadedProjectsNanoseconds,
    StatisticId::EmitNanoseconds,
];

fn emit_on_threads(thread_count: u32) -> Statistics {
    let mut project = TestProject::new(&PROGRAM, &default_settings());
    project.aot.thread_count = NonZeroU32::new(thread_count);
    let mut log = Log::init();
    match emit_program(&project.options(BUNDLED_LIBS), &WithoutServices, &mut log) {
        Ok(emitted) => emitted.summary.statistics,
        Err(failed) => panic!(
            "the build failed in stage \"{}\":\n{}",
            failed.stage.name(),
            describe_messages(&log)
        ),
    }
}

#[test]
fn steps_of_link_and_emit_are_timed() {
    for thread_count in [1, 4] {
        let statistics = emit_on_threads(thread_count);
        let times = STEPS_OF_LINK_AND_EMIT.map(|step| statistics.get(step));
        assert!(times.iter().all(|&time| time > 0), "{times:?}");
        let stage_time = statistics.get(Stage::LinkAndEmit.time());
        assert!(
            times.iter().sum::<u64>() <= stage_time,
            "{times:?} in {stage_time}"
        );
    }
}

#[test]
fn load_of_runtime_project_is_timed() {
    let statistics = emit_on_threads(1);
    let time = statistics.get(StatisticId::LoadRuntimeProjectNanoseconds);
    assert!(time > 0);
    assert!(time <= statistics.get(Stage::Load.time()));
}

#[test]
fn build_without_engine_has_no_engine_times() {
    let statistics = emit_on_threads(1);
    assert_eq!(statistics.get(StatisticId::EngineCallNanoseconds), 0);
    assert_eq!(statistics.get(StatisticId::AfterEngineNanoseconds), 0);
}

#[test]
fn sessions_outlive_loaded_projects() {
    let project = TestProject::new(&PROGRAM, &default_settings());
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        build.with_loaded_projects(|build, _| {
            assert!(build.retired_sessions.is_empty());
            Ok(())
        })?;
        assert_eq!(build.retired_sessions.len(), ProjectId::COUNT);
        Ok(())
    });
}
