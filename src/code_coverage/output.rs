use std::borrow::Cow;

use bun_ast::Loader;
use bun_collections::index_sort;
use bun_core::fmt::quote;
use bun_core::strings::visible::width::exclude_ansi_colors::utf8 as width_of;
use bun_core::{Output, err_generic, note, warn};
use bun_options_types::code_coverage_options::{Reporters, Thresholds};
use bun_paths::Path;
use bun_removable_features::removable_definition;
use bun_sys::{Fd, O, Tmpfile};

use crate::collector::Collector;
use crate::files::{self, Counts};
use crate::filter::{Selection, warn_about_unread};
use crate::format::{self, Row, Table};
use crate::report::Summary;
use crate::walk::{self, NoReport};
use crate::with_tree;

struct Job<'a> {
    path: &'a [u8],
    loader: Loader,
    /// `None`: nothing loaded it.
    loaded: Option<&'a Counts>,
    result: Result<Rendered, Failure>,
}

enum Failure {
    IsIgnored,
    CannotBeRead(bun_sys::Error),
    CannotBeParsed,
}

struct Rendered {
    row: Row,
    lcov: Vec<u8>,
    json: Vec<u8>,
}

/// The files that have thresholds of their own.
struct Group<'a> {
    pattern: &'a [u8],
    selection: Selection,
    thresholds: &'a Thresholds,
    rows: Vec<usize>,
}

struct Settings<'a> {
    collector: &'a Collector,
    reporters: Reporters,
    has_colors: bool,
}

impl<'a> Job<'a> {
    fn new(path: &'a [u8], loader: Loader, loaded: Option<&'a Counts>) -> Job<'a> {
        Job {
            path,
            loader,
            loaded,
            result: Err(Failure::CannotBeParsed),
        }
    }

    fn render(&self, settings: &Settings<'_>) -> Result<Rendered, Failure> {
        let text = match self.loaded {
            Some(loaded) => Cow::Borrowed(&*loaded.text.bytes),
            None => Cow::Owned(files::read(self.path).map_err(Failure::CannotBeRead)?),
        };
        let (collector, counts) = (settings.collector, self.loaded.map(|it| &*it.counts));
        if counts.is_none() && collector.find_bundle(self.path, &text).is_some() {
            return Err(Failure::IsIgnored);
        }
        let report = with_tree(self.loader, &text, |hir, atoms| {
            walk::report(hir, atoms, &text, counts)
        });
        let report = match report {
            Some(Ok(report)) => report,
            Some(Err(NoReport::IsIgnored)) => return Err(Failure::IsIgnored),
            Some(Err(NoReport::CannotBeParsed)) | None => return Err(Failure::CannotBeParsed),
        };
        let mut row = Row {
            name: (Path::relative(collector.filter.root(), self.path).as_bytes()).into(),
            summary: report.summary(),
            thresholds: collector.options.thresholds,
            uncovered_lines: Vec::new(),
        };
        let (mut lcov, mut json) = (Vec::new(), Vec::new());
        if settings.reporters.text {
            format::write_uncovered_lines(&mut row.uncovered_lines, &report, settings.has_colors);
        }
        if settings.reporters.lcov {
            format::write_lcov(&mut lcov, &row.name, &report, &row.summary);
        }
        if settings.reporters.json {
            format::write_json(&mut json, self.path, &report);
        }
        Ok(Rendered { row, lcov, json })
    }
}

/// Written under another name, and late, so that a run that is interrupted leaves the folder as it was.
struct ReportFile<'a> {
    collector: &'a Collector,
    name: &'static str,
    unwritten: Vec<u8>,
    file_and_path: Option<bun_sys::Result<(Tmpfile<Path>, Path)>>,
}

impl ReportFile<'_> {
    fn open(&self) -> bun_sys::Result<(Tmpfile<Path>, Path)> {
        let directory = &self.collector.options.reports_directory;
        let resolve = |name: &str| {
            let path = Path::resolve(&[self.collector.filter.root(), directory, name.as_bytes()]);
            path.check_len().map_err(|_| {
                bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open)
                    .with_path(directory)
            })
        };
        let (name, random) = (self.name, bun_core::fast_random());
        let temporary = resolve(&format!(".{name}.{random:016x}.tmp"))?;
        let _ = bun_sys::mkdir_recursive_at_mode(Fd::cwd(), &resolve("")?, 0o777);
        let flags = O::CREAT | O::RDWR | O::TRUNC | O::CLOEXEC;
        let file = Tmpfile::open(Fd::cwd(), temporary, flags, 0o644)?;
        Ok((file, resolve(name)?))
    }

    fn flush(&mut self) -> bun_sys::Result<(Tmpfile<Path>, Path)> {
        let unwritten = core::mem::take(&mut self.unwritten);
        let file_and_path = self.file_and_path.take().unwrap_or_else(|| self.open())?;
        file_and_path.0.file.write_all(&unwritten)?;
        Ok(file_and_path)
    }

    fn write(&mut self, bytes: &[u8]) {
        self.unwritten.extend_from_slice(bytes);
        if self.unwritten.len() > 16 << 20 {
            self.file_and_path = Some(self.flush());
        }
    }

    fn finish(mut self) -> Result<(), (bun_sys::Error, &'static str)> {
        self.flush()
            .and_then(|(file, path)| file.finish(&path).map_err(|it| it.0))
            .map_err(|error| (error, self.name))
    }
}

fn check_summary(thresholds: &Thresholds, summary: &Summary, files: Option<&[u8]>) -> bool {
    let mut are_met = true;
    for (name, total, threshold) in format::metrics(summary, thresholds) {
        let Some(threshold) = threshold.filter(|&it| total.misses(it)) else {
            continue;
        };
        are_met = false;
        let files = files.map_or_else(String::new, |it| format!(" in {}", quote(it)));
        match threshold < 0.0 {
            true => err_generic!(
                "The number of uncovered {}{} is {}, which is above the threshold of {}",
                name,
                files,
                total.total - total.covered,
                -threshold,
            ),
            false => err_generic!(
                "Coverage of {}{} is {:.2}%, which is below the threshold of {}%",
                name,
                files,
                total.percent(),
                (threshold * 1e6).round() / 1e4,
            ),
        }
    }
    are_met
}

fn check_rows<'a>(
    thresholds: &Thresholds,
    rows: impl Iterator<Item = &'a Row>,
    pattern: Option<&[u8]>,
) -> bool {
    if thresholds.per_file {
        let are_low = rows.filter(|it| !check_summary(thresholds, &it.summary, Some(&it.name)));
        return are_low.count() == 0;
    }
    let mut all = Summary::default();
    rows.for_each(|it| all.add(&it.summary));
    check_summary(thresholds, &all, pattern)
}

impl Collector {
    /// The row that the table would have now. `None` if the file has none.
    #[inline(never)]
    pub fn row_of(&self, path: &[u8]) -> Option<Vec<u8>> {
        removable_definition!(TestCommand, Collector::row_of);
        let files = self.files();
        let loaded = files.reported().find(|it| *it.text.path == *path)?;
        let settings = Settings {
            collector: self,
            reporters: Reporters {
                text: true,
                ..Reporters::default()
            },
            has_colors: false,
        };
        let job = Job::new(path, loaded.text.loader, Some(loaded));
        let mut row = job.render(&settings).ok()?.row;
        row.name = path.into();
        let table = Table {
            width_of_names: width_of(path),
            has_colors: false,
        };
        let mut out = Vec::new();
        table.write_row(&mut out, &row);
        Some(out)
    }

    fn find_group<'a>(
        &self,
        pattern: &'a [u8],
        thresholds: &'a Thresholds,
        rows: &mut [(&[u8], Row)],
    ) -> Group<'a> {
        let mut group = Group {
            pattern,
            selection: self.filter.select(pattern),
            thresholds,
            rows: Vec::new(),
        };
        for (index, (path, row)) in rows.iter_mut().enumerate() {
            if self.filter.is_in(&group.selection, path) {
                group.rows.push(index);
                let of_row = &mut row.thresholds;
                of_row.functions = thresholds.functions.or(of_row.functions);
                of_row.lines = thresholds.lines.or(of_row.lines);
                of_row.statements = thresholds.statements.or(of_row.statements);
                of_row.branches = thresholds.branches.or(of_row.branches);
            }
        }
        group
    }

    /// False if a report could not be written or a threshold is not met.
    pub fn write_reports(&self) -> bool {
        for key in &self.options.unknown_thresholds {
            warn!("Ignoring {} in \"coverageThreshold\"", quote(key));
        }
        if !self.options.unknown_thresholds.is_empty() {
            note!(
                "The keys are \"lines\", \"functions\", \"statements\", \"branches\" and \"perFile\". A glob pattern takes a table of them."
            );
        }
        let (files, reporters) = (self.files(), self.options.reporters);
        let mut jobs: Vec<Job<'_>> = (files.reported())
            .map(|it| Job::new(&it.text.path, it.text.loader, Some(it)))
            .collect();
        let directory = &self.options.reports_directory;
        let others = (self.filter).find_others(jobs.iter().map(|it| it.path), directory);
        jobs.extend(
            (others.iter()).map(|it| Job::new(it, self.filter.loader_by_extension(it), None)),
        );
        let unchanged = jobs.extract_if(.., |it| self.filter.is_unchanged(it.path));
        let leaves_out_unchanged = unchanged.count() > 0;
        index_sort::sort_slice_unstable_by(&mut jobs, |a, b| a.path.cmp(b.path));

        let create = |name| ReportFile {
            collector: self,
            name,
            unwritten: Vec::new(),
            file_and_path: None,
        };
        let mut lcov = reporters.lcov.then(|| create("lcov.info"));
        let mut json = reporters.json.then(|| create("coverage-final.json"));
        let settings = Settings {
            collector: self,
            reporters,
            has_colors: Output::enable_ansi_colors_stderr(),
        };
        let (mut rows, mut all) = (Vec::with_capacity(jobs.len()), Summary::default());
        let render = |job: &mut Job<'_>| job.result = job.render(&settings);
        self.pool.warm(1);
        // What is written about a file is many times as long as the file.
        for batch in jobs.chunks_mut(256) {
            match self.pool.has_workers() {
                true => self.pool.each_ptr((), |(), job, _| render(job), batch),
                false => batch.iter_mut().for_each(render),
            }
            for job in batch {
                match core::mem::replace(&mut job.result, Err(Failure::IsIgnored)) {
                    Ok(rendered) => {
                        if let Some(file) = &mut lcov {
                            file.write(&rendered.lcov);
                        }
                        if let Some(file) = &mut json {
                            file.write(if rows.is_empty() { b"{" } else { b"," });
                            file.write(&rendered.json);
                        }
                        all.add(&rendered.row.summary);
                        rows.push((job.path, rendered.row));
                    }
                    Err(Failure::IsIgnored) => {}
                    Err(Failure::CannotBeRead(error)) => warn_about_unread(job.path, &error),
                    Err(Failure::CannotBeParsed) => warn!(
                        "Failed to parse {}. It is not in the coverage report.",
                        quote(job.path),
                    ),
                }
            }
        }
        if let Some(file) = &mut json {
            file.write(if rows.is_empty() { b"{}\n" } else { b"}\n" });
        }
        let of_files = (!rows.is_empty()).then_some(&all);
        let summary = reporters.json_summary.then(|| {
            let mut out = vec![b'{'];
            format::write_json_summary(&mut out, b"total", of_files);
            for (path, row) in &rows {
                out.push(b',');
                format::write_json_summary(&mut out, path, Some(&row.summary));
            }
            out.extend_from_slice(b"}\n");
            let mut file = create("coverage-summary.json");
            file.write(&out);
            file
        });

        let failures: Vec<_> = ([lcov, json, summary].into_iter().flatten())
            .filter_map(|it| it.finish().err())
            .collect();

        let groups: Vec<_> = (self.options.thresholds_by_pattern.iter())
            .map(|(pattern, thresholds)| self.find_group(pattern, thresholds, &mut rows))
            .collect();
        let thresholds = &self.options.thresholds;
        if reporters.text {
            let widths = rows.iter().map(|it| width_of(&it.1.name));
            let table = Table {
                width_of_names: widths.fold(Table::ALL_FILES.len(), usize::max),
                has_colors: settings.has_colors,
            };
            let mut out = Vec::new();
            table.write_head(&mut out, of_files, thresholds);
            for (_, row) in &rows {
                table.write_row(&mut out, row);
                out.push(b'\n');
            }
            table.write_rule(&mut out);
            Output::flush();
            // A closed stderr is not a reason to fail the run.
            let _ = Output::error_writer().write_all(&out);
        }
        let mut is_ok = failures.is_empty();
        for (error, name) in failures {
            Output::err(error, "Failed to write {}", (name,));
        }
        let checked = || {
            (groups.iter().map(|it| it.thresholds).chain([thresholds]))
                .flat_map(|it| format::metrics(&all, it))
                .filter_map(|it| it.2)
        };
        if rows.is_empty() && !leaves_out_unchanged && checked().any(|it| it != 0.0) {
            if self.options.include_patterns.is_empty() {
                warn!("No file is in the coverage report, so \"coverageThreshold\" is not checked");
            } else {
                err_generic!(
                    "No file is in the coverage report, so \"coverageThreshold\" is not met"
                );
                is_ok = false;
            }
        }
        is_ok &= check_rows(thresholds, rows.iter().map(|it| &it.1), None);
        for group in &groups {
            let members = group.rows.iter().map(|&it| &rows[it].1);
            is_ok &= check_rows(group.thresholds, members, Some(group.pattern));
            let pattern = quote(group.pattern);
            match &group.selection {
                _ if !group.rows.is_empty() => {}
                Selection::Only(it) if it.find_files().is_empty() => {
                    err_generic!("No file matches {} in \"coverageThreshold\"", pattern);
                    is_ok = false;
                }
                _ if rows.is_empty() || leaves_out_unchanged => {}
                _ => warn!(
                    "No file in the coverage report matches {}, so its thresholds are not checked",
                    pattern,
                ),
            }
        }
        if !checked().all(|it| it <= 1.0) {
            note!("A threshold is a number from 0 to 1, such as 0.9 for 90%");
        }
        Output::flush();
        is_ok
    }
}
