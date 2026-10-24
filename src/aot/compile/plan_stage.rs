use super::Build;
use super::load_stage::{find_defined_string, max_computed_candidates};
use crate::builtins::unlinked_files::UnlinkedFiles;
use crate::builtins::{BuiltinNames, BuiltinValuePaths, builtin_type_paths};
use crate::diagnostics::{Diagnostic, LoadMessages, Severity};
use crate::emit::emit;
use crate::engine;
use crate::ir::{Id, run_serially};
use crate::load::fold_inputs::create_application_fold_inputs;
use crate::load::host::{LoadHost, LoadHostInput, create_disk};
use crate::load::runtime_modules::RuntimeModules;
use crate::load::sources::parsed_source;
use crate::load::typed_packages::TypedPackages;
use crate::lower::{PlanInputs, PlannedFile, plan_validated_calls};
use crate::statistics::{LimitId, Stage};
use crate::validation_plans::{PlannedValidation, RefusedValidation, ValidationPlans};
use bun_builtin_sources::Archive;
use bun_sema::atom::Interner;
use bun_sema::check::aot::{BuiltinTypeSymbols, FileOrigin, QueryInputs};
use bun_sema::resolve::CodeOptions;
use bun_sema::session::Session;
use bun_sema_driver::host::from_native;
use bun_sema_driver::{CompileRequest, EntryPoints, check_and_lower, decide_roles};

fn refuse(diagnostic: &Diagnostic) -> Option<RefusedValidation> {
    if diagnostic.severity != Severity::Error {
        return None;
    }
    let mut message = format!("TS{}: ", diagnostic.code.number()).into_bytes();
    message.extend_from_slice(&diagnostic.code.message(&diagnostic.arguments));
    Some(RefusedValidation {
        position: diagnostic.span?.start,
        message,
    })
}

impl Build<'_> {
    pub(super) fn plan_validated_calls(&mut self) -> Result<ValidationPlans, Stage> {
        let session = Session::new();
        let plans = self.plan_in_session(&session);
        self.retired_sessions.push(session);
        plans
    }

    // The files are loaded as a build loads them, so a type means here what it means in an executable.
    fn plan_in_session(&mut self, session: &Session) -> Result<ValidationPlans, Stage> {
        self.clock.start(Stage::Load);
        let options = self.options;
        let disk = create_disk(options, self.threads);
        let atoms = Interner::new_in(session);
        let builtin_names = BuiltinNames::new(&atoms);
        let omits_builtin_modules = options.load.omits_builtin_modules;
        let runtime_modules = RuntimeModules::new(Archive::embedded(), omits_builtin_modules)
            .with_test_aliases(options.load.runs_tests);
        let messages = LoadMessages::default();
        let typed_packages = TypedPackages::new(&disk, &from_native(&options.load.project_root));
        let provided =
            messages.with_log(|log| self.provider.fold_options(session.arena(), &atoms, log));
        let fold = create_application_fold_inputs(
            &provided,
            session.arena(),
            &atoms,
            &self.limits,
            self.platform,
        );
        let code = CodeOptions {
            max_computed_candidates: max_computed_candidates(&self.limits),
            ..options.code.clone()
        };
        let limits = self.limits.clone();
        let defined = |path: &[u8]| find_defined_string(provided.defines, &atoms, path);
        let host = LoadHost::new(LoadHostInput {
            disk: &disk,
            provider: self.provider,
            options,
            runtime_modules: &runtime_modules,
            messages: &messages,
            builtin_names: &builtin_names,
            typed_packages: &typed_packages,
            defined: &defined,
            platform: self.platform,
            limits: &limits,
        });
        let request = CompileRequest {
            entry_points: EntryPoints::Written(&options.entry_points),
            code: &code,
            fold: &fold,
            atoms,
            libs: options.typescript_libs,
            project_origin: FileOrigin::NoFile,
            threads: self.threads,
            progress: None,
            left_out_bodies: None,
        };
        let application = self.load_application(session, &host, &request, &messages)?;
        let files = application.files();
        let &[file] = files.entry_points() else {
            return Err(Stage::Load);
        };
        let Some(source) = parsed_source(files, file) else {
            return Err(Stage::Load);
        };

        self.clock.start(Stage::Check);
        // No file is checked for the sake of its role: a type is asked for, and what it is made of is read.
        let roles = decide_roles(&application, &host, &request, &[]);
        let value_paths = BuiltinValuePaths::collect(self.platform);
        let (type_paths, value_paths) = (builtin_type_paths(), value_paths.paths());
        let builtin_types = BuiltinTypeSymbols::compute(files, &type_paths, &value_paths);
        let named_values = UnlinkedFiles::new(files, &request.atoms);
        let inputs = PlanInputs {
            queries: QueryInputs {
                roles: &roles.roles,
                checked_elsewhere: &[],
                builtin_types: &builtin_types,
                named_values: &named_values,
                max_inference_nodes: limits.get(LimitId::MaxInferenceNodes),
            },
            builtins: &source.builtins,
            limits: &limits,
        };
        let checked = check_and_lower(
            &application,
            &host,
            &request,
            &roles,
            &[file],
            &|checker, file| plan_validated_calls(&inputs, checker, file),
        );
        let Some((_, planned)) = checked.lowered.into_iter().next() else {
            return Err(Stage::Check);
        };
        drop(typed_packages);

        self.clock.start(Stage::LinkAndEmit);
        let PlannedFile {
            program,
            calls,
            diagnostics,
        } = planned;
        let texts = match calls.is_empty() {
            true => Vec::new(),
            false => {
                let bytes = emit(program, &run_serially).map_err(|_| Stage::LinkAndEmit)?;
                engine::write_validation_plans(&bytes)
            }
        };
        let mut plans = ValidationPlans {
            calls: Vec::with_capacity(calls.len()),
            refused: diagnostics.iter().filter_map(refuse).collect(),
        };
        for call in calls {
            // A call without a text is in neither list.
            if let Some(plan) = texts.get(call.expected.index()) {
                plans.calls.push(PlannedValidation {
                    type_argument: call.type_argument,
                    function: call.function,
                    plan: plan.clone(),
                });
            }
        }
        plans.calls.sort_by_key(|call| call.type_argument);
        Ok(plans)
    }
}
