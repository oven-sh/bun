use super::*;
use crate::hir::ExprId;
use crate::import_sites::ImportSite;
use crate::resolve::{ComputedResolution, SiteResolution, is_typescript_file_name};

fn names_unknown_file_at(
    file: &WalkedFile<'_, '_>,
    is_asked: &dyn Fn(&ImportSite) -> bool,
) -> bool {
    let Some(parsed) = &file.parsed else {
        return false;
    };
    let sites = parsed.code.analyzed.analysis.import_sites;
    sites
        .iter()
        .zip(&parsed.code.resolutions)
        .any(|(site, resolution)| {
            matches!(
                resolution,
                SiteResolution::Computed(ComputedResolution::All { .. })
            ) && is_asked(site)
        })
}

struct NamedEntryPoints<'r> {
    written: Vec<u32>,
    named: Vec<(LoadKey<'r>, u32, Vec<NamingLoad>)>,
}

impl<'r> NamedEntryPoints<'r> {
    fn new(context: &CodeLoadContext<'_, '_, 'r>, state: &WalkState<'_, '_>) -> Self {
        let mut entry_points = NamedEntryPoints {
            written: Vec::new(),
            named: Vec::new(),
        };
        for entry_point in &context.entry_points() {
            let index = state.index_of[&context.canonical_key(entry_point.key)];
            match context.loads_that_alone_name(entry_point.key) {
                Some(loads) => entry_points.named.push((entry_point.key, index, loads)),
                None => entry_points.written.push(index),
            }
        }
        entry_points
    }

    fn list_what_each_file_names(
        &self,
        file_count: usize,
        counts: impl Fn(&NamingLoad) -> bool,
    ) -> Vec<Vec<u32>> {
        let mut named_from: Vec<Vec<u32>> = vec![Vec::new(); file_count];
        for (_, index, loads) in &self.named {
            for load in loads.iter().filter(|load| counts(load)) {
                if let Some(named) = named_from.get_mut(load.written_in.0 as usize) {
                    named.push(*index);
                }
            }
        }
        named_from
    }
}

pub(super) fn find_files_of_program(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &WalkState<'_, '_>,
) -> Vec<bool> {
    find_files_reached(context, state, |_| true)
}

fn find_files_reached(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &WalkState<'_, '_>,
    counts: impl Fn(&NamingLoad) -> bool,
) -> Vec<bool> {
    let entry_points = NamedEntryPoints::new(context, state);
    let named_from = entry_points.list_what_each_file_names(state.files.len(), counts);
    let mut is_reached = vec![false; state.files.len()];
    reach(
        &state.files,
        &named_from,
        entry_points.written,
        &mut is_reached,
    );
    is_reached
}

pub(super) fn program_rules_out_guesses(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &WalkState<'_, '_>,
) -> bool {
    let is_of_program = find_files_of_program(context, state);
    let is_sure = find_files_reached(context, state, |load| !load.may_be_left_out);
    let files = state.files.iter().zip(is_of_program).zip(is_sure);
    let mut files = files.filter(|it| it.0.1).map(|it| (it.0.0, it.1));
    files.any(|(file, is_sure)| match is_sure {
        true => names_unknown_file_where_nothing_is_written(file),
        false => {
            names_unknown_file_at(file, &|_| true) || is_typescript_file_name(file.target.key.path)
        }
    })
}

fn names_unknown_file_where_nothing_is_written(file: &WalkedFile<'_, '_>) -> bool {
    let analysis = file.parsed.as_ref().map(|it| &it.code.analyzed.analysis);
    let guessed = analysis.into_iter().flat_map(|it| it.names_from_data_files);
    let guessed: FxHashSet<ExprId> = guessed.filter(|it| it.2).map(|it| it.1).collect();
    names_unknown_file_at(file, &|site| !guessed.contains(&site.specifier_node))
}

fn reach(
    files: &[WalkedFile<'_, '_>],
    named_from: &[Vec<u32>],
    mut to_visit: Vec<u32>,
    is_reached: &mut [bool],
) {
    while let Some(file) = to_visit.pop() {
        if !std::mem::replace(&mut is_reached[file as usize], true) {
            let targets = files[file as usize].targets.iter().copied();
            to_visit.extend(targets.filter(|&target| target != NOT_LOADED));
            to_visit.extend_from_slice(&named_from[file as usize]);
        }
    }
}

pub(super) fn let_all_guesses_go(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &mut WalkState<'_, '_>,
) -> bool {
    let entry_points = NamedEntryPoints::new(context, state);
    context.let_no_guess_in();
    let is_of_program = find_files_of_program(context, state);
    let dead = entry_points.named.iter();
    let dead = dead.filter(|it| !is_of_program[it.1 as usize]);
    let dead: Vec<LoadKey<'_>> = dead.map(|it| it.0).collect();
    context.leave_out_found_entry_points(&dead);
    true
}
