use core::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use bun_ast::Loader;
use bun_ast::coverage::{Anchors, Place, Placed, PlacedInText, Placement, Printing};
use bun_collections::{StringArrayHashMap, StringSet};
use bun_core::strings;
use bun_options_types::code_coverage_options::CodeCoverageOptions;
use bun_removable_features::removable_definition;
use bun_sema::hir::find_transpiled_mark;
use bun_sema::session::Session;
use bun_threading::Guarded;
use bun_threading::thread_pool::{Config, ThreadPool};

use crate::bundle::Bundle;
use crate::files::{Counts, Files, Text};
use crate::filter::{Filter, Project};
use crate::report::UNKNOWN;
use crate::{Target, find_anchors, mark_nodes, with_tree};

/// The coverage of this process.
pub struct Collector {
    pub(crate) options: CodeCoverageOptions,
    pub(crate) filter: Filter,
    /// By the path of the module, in the order of their last loads.
    running: Guarded<StringArrayHashMap<Vec<Running>>>,
    of_other_processes: Guarded<Files>,
    /// Tests can leave all threads of `WorkPool` waiting for a pipe.
    pub(crate) pool: ThreadPool,
}

/// The files that a module is made from, and how many counters each has.
type Sources = Vec<(Arc<Text>, u32)>;

struct Running {
    sources: Sources,
    unplaced: Vec<u32>,
    /// By the thread that adds to them.
    counts: Vec<(u64, Arc<[AtomicU64]>)>,
}

impl Running {
    fn counts_for_this_thread(&mut self, counters: u32) -> Arc<[AtomicU64]> {
        let thread = bun_threading::current_thread_id();
        let mut all = self.counts.iter_mut();
        if let Some(found) = all.find_map(|(owner, counts)| {
            (*owner == thread || Arc::get_mut(counts).is_some()).then_some((owner, counts))
        }) {
            *found.0 = thread;
            return Arc::clone(found.1);
        }
        let counts: Arc<[AtomicU64]> = (0..counters).map(|_| AtomicU64::new(0)).collect();
        self.counts.push((thread, Arc::clone(&counts)));
        counts
    }

    fn add_to(&self, files: &mut Files) {
        for (_, counts) in &self.counts {
            // A worker can still be adding to them, in no order with anything else.
            let mut counts: Vec<u64> = counts.iter().map(|it| it.load(Ordering::Relaxed)).collect();
            for &counter in &self.unplaced {
                counts[counter as usize] = UNKNOWN;
            }
            for (text, counters) in self.sources.iter().rev() {
                let counts = counts.split_off(counts.len() - *counters as usize);
                let text = Arc::clone(text);
                files.add(Counts { text, counts });
            }
        }
    }
}

/// For the `JSC::SourceProvider` of a module.
pub struct CountedText {
    collector: &'static Collector,
    path: Box<[u8]>,
    sources: Sources,
    placed: PlacedInText,
    counts: Option<Arc<[AtomicU64]>>,
}

/// A file between the parser and the printer.
pub struct Transpiling {
    collector: &'static Collector,
    text: Arc<Text>,
    pub printing: Printing,
    pub can_be_cached: bool,
}

impl Transpiling {
    pub fn finish(self, printed: &[u8]) -> Box<CountedText> {
        (self.collector).count_printed(self.text, self.printing.placed, printed)
    }
}

impl Collector {
    pub fn new(options: CodeCoverageOptions, project: Project) -> Collector {
        Collector {
            filter: Filter::new(&options, project),
            options,
            running: Guarded::default(),
            of_other_processes: Guarded::default(),
            pool: ThreadPool::init(Config {
                max_threads: bun_core::get_thread_count().into(),
                ..Config::default()
            }),
        }
    }

    pub fn ignores_source_maps(&self) -> bool {
        self.options.ignore_sourcemap
    }

    pub fn report_only(&self, changed_files: StringSet) {
        let _ = self.filter.changed_files.set(changed_files);
    }

    #[inline(never)]
    pub fn covers(&self, path: &[u8], loader: Loader) -> bool {
        removable_definition!(TestCommand, Collector::covers);
        loader.is_javascript_like()
            && self.filter.is_source_file(path)
            && self.filter.is_selected(path)
    }

    #[inline(never)]
    pub fn will_print(&'static self, path: &[u8], loader: Loader, contents: &[u8]) -> Transpiling {
        removable_definition!(TestCommand, Collector::will_print);
        let anchors = match self.ignores_source_maps() {
            true => None,
            false => find_anchors(loader, contents),
        };
        Transpiling {
            collector: self,
            text: Text::new(path, loader, contents),
            can_be_cached: anchors.is_some(),
            printing: Printing {
                placement: Placement::new(anchors.unwrap_or_default()),
                placed: PlacedInText::default(),
            },
        }
    }

    pub fn count_cached(
        &'static self,
        (path, loader, text): (&[u8], Loader, &[u8]),
        placed: PlacedInText,
        printed: &[u8],
    ) -> Box<CountedText> {
        self.count_printed(Text::new(path, loader, text), placed, printed)
    }

    fn count_printed(
        &'static self,
        text: Arc<Text>,
        placed: PlacedInText,
        printed: &[u8],
    ) -> Box<CountedText> {
        match self.ignores_source_maps() {
            true => self.count_as_written(&text.path, printed),
            false => self.count(text, placed),
        }
    }

    /// JavaScriptCore gets a character for each byte of `code`.
    #[inline(never)]
    pub fn count_as_written(&'static self, path: &[u8], code: &[u8]) -> Box<CountedText> {
        removable_definition!(TestCommand, Collector::count_as_written);
        let anchors = find_anchors(Loader::Js, code).unwrap_or_default();
        let placed = place_as_written(code, anchors, |loc| [loc]);
        self.count(Text::new(path, Loader::Js, code), placed)
    }

    /// If its sources are reported in its place.
    pub(crate) fn find_bundle(&self, path: &[u8], text: &[u8]) -> Option<Bundle> {
        find_transpiled_mark(text).filter(|_| !self.ignores_source_maps())?;
        Bundle::find(path, text, &self.filter)
    }

    /// `// @bun`
    #[inline(never)]
    pub fn count_bundle(&'static self, path: &[u8], code: &[u8]) -> Option<Box<CountedText>> {
        removable_definition!(TestCommand, Collector::count_bundle);
        if self.options.include_patterns.is_empty()
            && (!self.filter.is_source_file(path) || self.filter.is_ignored(path))
        {
            return None;
        }
        let Some(bundle) = self.find_bundle(path, code) else {
            return (self.covers(path, Loader::Js)).then(|| self.count_as_written(path, code));
        };
        let (joined, anchors) = bundle.join(code);
        (!joined.texts.is_empty()).then(|| {
            Box::new(CountedText {
                collector: self,
                path: path.into(),
                placed: place_as_written(code, anchors, |loc| joined.locs_of(loc)),
                sources: joined.texts,
                counts: None,
            })
        })
    }

    /// `description`: the characters of what `describe_compiled_file` returned.
    pub fn count_compiled(&'static self, description: &[u8]) -> Option<Box<CountedText>> {
        let Counts { text, counts } = Counts::decode(description)?;
        let unplaced = (counts.iter().zip(0..)).filter(|it| *it.0 == UNKNOWN);
        let placed = PlacedInText {
            counters: counts.len() as u32,
            places: Vec::new(),
            unplaced: unplaced.map(|it| it.1).collect(),
        };
        Some(self.count(text, placed))
    }

    fn count(&'static self, text: Arc<Text>, placed: PlacedInText) -> Box<CountedText> {
        Box::new(CountedText {
            collector: self,
            path: text.path.clone(),
            sources: vec![(text, placed.counters)],
            placed,
            counts: None,
        })
    }

    pub(crate) fn files(&self) -> Files {
        let mut files = Files::default();
        for counts in self.of_other_processes.lock().all() {
            files.add(counts.clone());
        }
        for running in self.running.lock().values().iter().flatten() {
            running.add_to(&mut files);
        }
        files
    }

    /// For `add_encoded` in another process.
    pub fn for_each_encoded(&self, mut each: impl FnMut(&[u8])) {
        let mut encoded = Vec::new();
        for counts in self.files().all() {
            encoded.clear();
            counts.encode(&mut encoded);
            each(&encoded);
        }
    }

    pub fn has_counts_of_other_processes(&self) -> bool {
        self.of_other_processes.lock().all().next().is_some()
    }

    /// Tests can write to the pipe that `encoded` is from.
    pub fn add_encoded(&self, encoded: &[u8]) {
        if let Some(counts) = Counts::decode(encoded) {
            self.of_other_processes.lock().add(counts);
        }
    }
}

/// `locs_of_anchors`: for a `loc` in `text`.
fn place_as_written<Locs: IntoIterator<Item = u32>>(
    text: &[u8],
    anchors: Anchors,
    locs_of_anchors: impl Fn(u32) -> Locs,
) -> PlacedInText {
    let mut placement = Placement::new(anchors);
    with_tree(Loader::Js, text, |hir, _| {
        let session = Session::new();
        let mut hir = hir.lend(session.arena(), &session);
        hir.finish_nodes();
        hir.text = text.into();
        mark_nodes(&hir, &|_| false, &mut |role, loc, target| {
            let around = match target {
                Target::Expression(e) => hir.start(hir.parent(hir.child(e))),
                _ => loc,
            };
            // The value of a variable that is inlined is written before the code that it is in now.
            let around = locs_of_anchors(around).into_iter().min();
            for loc in locs_of_anchors(loc) {
                if around <= Some(loc) {
                    placement.mark(role, loc, target.offset(&hir));
                }
            }
        });
    });
    placement.finish_in(text)
}

/// A string, in UTF-8, for a compiled program to hold.
pub fn describe_compiled_file<T>(
    path: &[u8],
    loader: Loader,
    text: &[u8],
    placed: &Placed<T>,
) -> Vec<u8> {
    let mut counts = vec![0; placed.counters as usize];
    for &counter in &placed.unplaced {
        counts[counter as usize] = UNKNOWN;
    }
    let (text, mut encoded) = (Text::new(path, loader, text), Vec::new());
    Counts { text, counts }.encode(&mut encoded);
    bun_core::handle_oom(strings::allocate_latin1_into_utf8(&encoded))
}

/// `JSC::CoverageCounters`
#[repr(C)]
struct Counters {
    places: *const Place,
    place_count: usize,
    counts: *mut u64,
    count: usize,
}

/// On the thread that runs the module. The pointers are valid as long as `this`.
#[inline(never)]
#[unsafe(no_mangle)]
extern "C" fn Bun__CountedText__start(this: &mut CountedText) -> Counters {
    removable_definition!(TestCommand, Bun__CountedText__start);
    let mut running = this.collector.running.lock();
    let versions = bun_core::handle_oom(running.get_or_put(&this.path)).value_ptr;
    let (sources, unplaced) = (core::mem::take(&mut this.sources), &this.placed.unplaced);
    let is_same = |it: &mut Running| {
        let mut both = it.sources.iter().zip(&sources);
        it.sources.len() == sources.len()
            && both.all(|(old, new)| old.1 == new.1 && old.0.is_numbered_like(&new.0))
    };
    let same = versions.extract_if(.., is_same).next();
    let mut version = same.unwrap_or_else(|| Running {
        sources: sources.clone(),
        unplaced: unplaced.clone(),
        counts: Vec::new(),
    });
    for (old, new) in version.sources.iter_mut().zip(sources) {
        Text::update(&mut old.0, new.0);
    }
    (version.unplaced).retain(|it| unplaced.binary_search(it).is_ok());
    let counts = (this.counts).insert(version.counts_for_this_thread(this.placed.counters));
    versions.push(version);
    Counters {
        places: this.placed.places.as_ptr(),
        place_count: this.placed.places.len(),
        counts: counts.as_ptr().cast::<u64>().cast_mut(),
        count: counts.len(),
    }
}

/// `added` characters have taken the place of the first `removed` ones.
#[unsafe(no_mangle)]
extern "C" fn Bun__CountedText__didReplaceStart(this: &mut CountedText, removed: u32, added: u32) {
    for place in &mut this.placed.places {
        place.offset = (place.offset.checked_sub(removed)).map_or(0, |it| it.saturating_add(added));
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__CountedText__destroy(this: Box<CountedText>) {
    drop(this);
}
