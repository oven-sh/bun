use bun_ast::audited::{AuditedValidation, JSON_PARSE, REFUSED, VALIDATE};
use bun_sema_driver::FxHashMap as HashMap;
use bun_sema_driver::json_schemas::{Answer, Asked, json_parse_schemas, with_shared_parses};
use bun_threading::Guarded;
use std::sync::Arc;
use std::sync::mpsc::{Receiver, Sender, channel};

struct Known {
    source_hash: u64,
    validations: Arc<[AuditedValidation]>,
}

struct Job {
    path: Vec<u8>,
    text: Vec<u8>,
    done: Sender<()>,
}

static KNOWN: Guarded<Option<(u32, HashMap<Vec<u8>, Known>)>> = Guarded::new(None);
static JOBS: Guarded<Option<Sender<Job>>> = Guarded::new(None);
const KEEPS_PARSED_FILES_FOR: std::time::Duration = std::time::Duration::from_millis(100);

fn known(path: &[u8], source_hash: u64) -> Option<Arc<[AuditedValidation]>> {
    let known = KNOWN.lock();
    let (generation, by_path) = known.as_ref()?;
    by_path.get(path).filter(|it| *generation == bun_ast::audited::json_parse_schema_generation() && it.source_hash == source_hash).map(|it| Arc::clone(&it.validations))
}

pub(crate) fn of_file(path: &[u8], text: &[u8]) -> Arc<[AuditedValidation]> {
    let source_hash = bun_wyhash::hash(text);
    if let Some(found) = known(path, source_hash) {
        return found;
    }
    let (done, is_done) = channel();
    let job = Job { path: path.to_vec(), text: text.to_vec(), done };
    {
        let mut jobs = JOBS.lock();
        let unsent = match jobs.as_ref() {
            Some(jobs) => jobs.send(job).err().map(|refused| refused.0),
            None => Some(job),
        };
        if let Some(job) = unsent {
            let (sender, receiver) = channel();
            let _ = sender.send(job);
            let thread = std::thread::Builder::new().stack_size(64 << 20).spawn(move || serve(&receiver));
            *jobs = thread.is_ok().then_some(sender);
        }
    }
    let _ = is_done.recv();
    known(path, source_hash).unwrap_or_else(|| Arc::new([]))
}

fn serve(jobs: &Receiver<Job>) {
    bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Schemas"));
    let cwd = super::check_command::working_directory();
    let mut put_off: Option<Job> = None;
    let mut serve_until_forgotten = || with_shared_parses(|shared| {
        let generation = bun_ast::audited::json_parse_schema_generation();
        loop {
            let job = match put_off.take().ok_or(()).or_else(|()| jobs.recv_timeout(KEEPS_PARSED_FILES_FOR)) {
                Ok(job) => job,
                Err(_) => {
                    let mut senders = JOBS.lock();
                    match jobs.try_recv() {
                        Ok(job) => job,
                        Err(_) => {
                            *senders = None;
                            return false;
                        }
                    }
                }
            };
            if generation != bun_ast::audited::json_parse_schema_generation() {
                put_off = Some(job);
                return true;
            }
            if known(&job.path, bun_wyhash::hash(&job.text)).is_none() {
                let paths = [job.path];
                keep(json_parse_schemas(
                    &Asked {
                        cwd: &cwd,
                        paths: &paths,
                        read: &[(&paths[0], &job.text)],
                        libs: bun_sema_driver::Libs::Bundled(super::typescript_libs::BUNDLED),
                        follows_every_import: false,
                    },
                    shared,
                ));
            }
            let _ = job.done.send(());
        }
    });
    while serve_until_forgotten() {}
}

fn keep(answer: Answer) {
    let generation = bun_ast::audited::json_parse_schema_generation();
    let mut known = KNOWN.lock();
    let (kept_in, by_path) = known.get_or_insert_default();
    if core::mem::replace(kept_in, generation) != generation {
        by_path.clear();
    }
    for (path, of_file) in answer.by_path {
        let mut validations: Vec<AuditedValidation> = (of_file.schemas.into_iter())
            .map(|it| AuditedValidation {
                next: it.end,
                start: it.start,
                which: match (&it.schema, it.is_json_parse) {
                    (Ok(_), true) => JSON_PARSE,
                    (Ok(_), false) => VALIDATE,
                    (Err(_), _) => REFUSED,
                },
                plan: it.schema.unwrap_or_else(String::into_bytes).into_boxed_slice(),
            })
            .collect();
        validations.sort_unstable_by_key(|it| (it.next, it.start));
        by_path.insert(path, Known { source_hash: bun_wyhash::hash(&of_file.text), validations: validations.into() });
    }
}
