use super::{AotBuild, AotEntryPoint};
use crate::OutputFile;
use crate::options::{OutputKind, Side};
use crate::output_file::{IndexOptional, Options, OptionsData};
use bun_aot::Compilation;
use bun_aot::compile::{EntryPointPaths, ProgramSummary};
use bun_ast::Loader;
use bun_paths::is_sep_any;

/// Entry point `i` is shown as `shown[i]`, the path of its source, and is a file of the executable under `embedded[i]`, the name that `bun build --compile` gives it.
pub(crate) struct EntryPointNames<'a> {
    pub module_prefix: &'a [u8],
    pub shown: &'a [Vec<u8>],
    pub embedded: &'a [Vec<u8>],
}

impl EntryPointNames<'_> {
    /// A program that runs in place has the paths of its files on disk, and no other names.
    fn file_name<'p>(&'p self, public_path: &'p [u8]) -> &'p [u8] {
        let Some(shown) = public_path.strip_prefix(self.module_prefix) else {
            return public_path;
        };
        match self.shown.iter().position(|name| is_shown_as(name, shown)) {
            Some(index) => &self.embedded[index],
            None => shown,
        }
    }
}

/// In a public path, a `..` that leaves the root directory of the build is `_.._`.
fn is_shown_as(name: &[u8], shown: &[u8]) -> bool {
    let segments = bun_core::strings::split(name, b"/");
    let segments = segments.map(|segment| {
        if segment == b".." {
            &b"_.._"[..]
        } else {
            segment
        }
    });
    segments.eq(bun_core::strings::split(shown, b"/"))
}

impl AotEntryPoint {
    /// The path of an entry point has the separators of the host, `C:\a\b.ts`. That of an embedded file is as the compiler writes it, `C:/a/b.ts`.
    pub fn is_source_of(&self, embedded: &OutputFile, is_windows: bool) -> bool {
        let is_same = |(&left, &right): (&u8, &u8)| {
            left == right || (is_windows && is_sep_any(left) && is_sep_any(right))
        };
        let (entry, copy) = (&self.source_path[..], embedded.src_path.text);
        entry.len() == copy.len() && entry.iter().zip(copy).all(is_same)
    }
}

pub(crate) fn finish_build(
    compilation: Compilation,
    names_of_entry_points: &EntryPointNames<'_>,
    embedded: Vec<OutputFile>,
) -> AotBuild {
    let Compilation {
        engine,
        summary,
        further_programs,
    } = compilation;
    let ProgramSummary {
        entry_points: entry_paths,
        folders: _,
        names,
        texts,
        statistics,
        modules,
    } = summary;
    let (output_files, entry_points) =
        collect_output_files(entry_paths, names_of_entry_points, embedded);
    AotBuild {
        output_files,
        engine,
        further_programs,
        entry_points,
        root_directory: Vec::new(),
        package_names: Vec::new(),
        names,
        texts,
        statistics,
        modules,
    }
}

fn collect_output_files(
    entry_paths: Vec<EntryPointPaths>,
    names: &EntryPointNames<'_>,
    mut embedded: Vec<OutputFile>,
) -> (Vec<OutputFile>, Vec<AotEntryPoint>) {
    let mut output_files = Vec::with_capacity(entry_paths.len() + embedded.len());
    let mut entry_points = Vec::with_capacity(entry_paths.len());
    for file in &mut embedded {
        file.entry_point_index = None;
    }
    for (index, entry) in entry_paths.into_iter().enumerate() {
        // The files of an executable are named with forward slashes on every host.
        let mut graph_path = entry.public_path.clone();
        bun_paths::resolve_path::platform_to_posix_in_place::<u8>(&mut graph_path);
        let dest_path = names.file_name(&graph_path);
        // An entry point that has the path of an embedded copy of its source: the copy is its file.
        let is_copy = |file: &&mut OutputFile| {
            !names.module_prefix.is_empty()
                && file.output_kind == OutputKind::Asset
                && file.entry_point_index.is_none()
                && bun_core::strings::remove_leading_dot_slash(&file.dest_path) == dest_path
        };
        match embedded.iter_mut().find(is_copy) {
            Some(copy) => copy.entry_point_index = Some(index as u32),
            None => output_files.push(create_entry_file(
                dest_path,
                &entry.source_path,
                index as u32,
            )),
        }
        entry_points.push(AotEntryPoint {
            source_path: entry.source_path,
            module_path: entry.public_path,
        });
    }
    let entry_count = output_files.len();
    for mut file in embedded {
        if file.source_map_index != u32::MAX {
            file.source_map_index += entry_count as u32;
        }
        // In place, an entry point that is embedded, a native addon, has one name for its file and for its bytes, and of two files with one name the executable keeps the first.
        let entry_files = &mut output_files[..entry_count];
        if let Some(entry_file) = entry_files
            .iter_mut()
            .find(|entry_file| entry_file.dest_path == file.dest_path)
        {
            core::mem::swap(&mut entry_file.value, &mut file.value);
            core::mem::swap(&mut entry_file.loader, &mut file.loader);
            core::mem::swap(&mut entry_file.size, &mut file.size);
            core::mem::swap(
                &mut entry_file.size_without_sourcemap,
                &mut file.size_without_sourcemap,
            );
        }
        output_files.push(file);
    }
    (output_files, entry_points)
}

fn create_entry_file(dest_path: &[u8], source_path: &[u8], index: u32) -> OutputFile {
    OutputFile::init(Options {
        loader: Loader::Js,
        input_loader: Loader::Js,
        hash: None,
        source_map_index: None,
        bytecode_index: None,
        module_info_index: None,
        output_path: Box::from(dest_path),
        source_index: IndexOptional::NONE,
        size: None,
        input_path: Box::from(source_path),
        display_size: 0,
        output_kind: OutputKind::EntryPoint,
        is_executable: false,
        data: OptionsData::Buffer {
            data: Box::default(),
        },
        side: Some(Side::Server),
        entry_point_index: Some(index),
        referenced_css_chunks: Box::default(),
        bake_extra: Default::default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PREFIX: &[u8] = b"/$bunfs/root/";

    fn entry(public_path: &[u8], source_path: &[u8]) -> EntryPointPaths {
        EntryPointPaths {
            public_path: public_path.to_vec(),
            source_path: source_path.to_vec(),
        }
    }

    fn names(names: &[&str]) -> Vec<Vec<u8>> {
        names.iter().map(|name| name.as_bytes().to_vec()).collect()
    }

    fn embedded_file(dest_path: &[u8], source_map_index: Option<u32>) -> OutputFile {
        let mut file = create_entry_file(dest_path, dest_path, 0);
        file.output_kind = OutputKind::Asset;
        file.entry_point_index = None;
        file.source_map_index = source_map_index.unwrap_or(u32::MAX);
        file
    }

    #[test]
    fn file_names_of_entry_points() {
        let (shown, embedded) = (
            names(&["a.ts", "../lib/b.mjs"]),
            names(&["app", "_.._/lib/b.js"]),
        );
        let names = EntryPointNames {
            module_prefix: PREFIX,
            shown: &shown,
            embedded: &embedded,
        };
        assert_eq!(names.file_name(b"/$bunfs/root/a.ts"), b"app");
        assert_eq!(
            names.file_name(b"/$bunfs/root/_.._/lib/b.mjs"),
            b"_.._/lib/b.js"
        );
        assert_eq!(names.file_name(b"/$bunfs/root/a.ts?text"), b"a.ts?text");
        assert_eq!(names.file_name(b"/project/a.ts"), b"/project/a.ts");
    }

    #[test]
    fn entries_precede_embedded_files() {
        let (shown, embedded_names) = (names(&["a.ts", "b.mjs"]), names(&["app", "b.js"]));
        let (files, entries) = collect_output_files(
            vec![
                entry(b"/$bunfs/root/a.ts", b"/project/a.ts"),
                entry(b"/$bunfs/root/b.mjs", b"/project/b.mjs"),
            ],
            &EntryPointNames {
                module_prefix: PREFIX,
                shown: &shown,
                embedded: &embedded_names,
            },
            vec![
                embedded_file(b"c.js.map", None),
                embedded_file(b"c.js", Some(0)),
            ],
        );
        let paths: Vec<&[u8]> = files.iter().map(|file| &*file.dest_path).collect();
        assert_eq!(paths, [&b"app"[..], b"b.js", b"c.js.map", b"c.js"]);
        assert_eq!(files[0].entry_point_index, Some(0));
        assert_eq!(files[1].entry_point_index, Some(1));
        assert_eq!(files[2].source_map_index, u32::MAX);
        assert_eq!(files[3].source_map_index, 2);
        assert_eq!(entries[1].source_path, b"/project/b.mjs");
        assert_eq!(entries[1].module_path, b"/$bunfs/root/b.mjs");
    }

    #[test]
    fn embedded_file_is_not_entry_point() {
        let mut page_script = embedded_file(b"page.js", None);
        page_script.output_kind = OutputKind::EntryPoint;
        page_script.entry_point_index = Some(0);
        let (files, entries) = collect_output_files(
            vec![entry(b"/$bunfs/root/a.ts", b"/project/a.ts")],
            &EntryPointNames {
                module_prefix: PREFIX,
                shown: &names(&["a.ts"]),
                embedded: &names(&["a.js"]),
            },
            vec![page_script],
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(files[0].entry_point_index, Some(0));
        assert_eq!(&*files[1].dest_path, b"page.js");
        assert_eq!(files[1].entry_point_index, None);
    }

    #[test]
    fn embedded_copy_is_the_file_of_the_entry_point_with_its_path() {
        let (files, entries) = collect_output_files(
            vec![
                entry(b"/$bunfs/root/a.ts", b"/project/a.ts"),
                entry(b"/$bunfs/root/worker-1a2b.js", b"/project/worker.js"),
            ],
            &EntryPointNames {
                module_prefix: PREFIX,
                shown: &names(&["a.ts"]),
                embedded: &names(&["a.js"]),
            },
            vec![
                embedded_file(b"./c.js.map", None),
                embedded_file(b"./worker-1a2b.js", Some(0)),
            ],
        );
        let paths: Vec<&[u8]> = files.iter().map(|file| &*file.dest_path).collect();
        assert_eq!(paths, [&b"a.js"[..], b"./c.js.map", b"./worker-1a2b.js"]);
        assert_eq!(files[1].entry_point_index, None);
        assert_eq!(files[2].entry_point_index, Some(1));
        assert_eq!(files[2].output_kind, OutputKind::Asset);
        assert_eq!(files[2].source_map_index, 1);
        assert_eq!(entries[1].module_path, b"/$bunfs/root/worker-1a2b.js");
    }

    #[test]
    fn entry_point_is_the_source_of_its_embedded_copy() {
        let entry_point = |source_path: &[u8]| AotEntryPoint {
            source_path: source_path.to_vec(),
            module_path: Vec::new(),
        };
        let copy = |source_path: &[u8]| create_entry_file(b"worker-1a2b.js", source_path, 0);
        let on_windows = entry_point(b"C:\\project\\worker.js");
        assert!(on_windows.is_source_of(&copy(b"C:/project/worker.js"), true));
        assert!(on_windows.is_source_of(&copy(b"C:\\project\\worker.js"), true));
        assert!(!on_windows.is_source_of(&copy(b"C:/project/other.js"), true));
        assert!(!on_windows.is_source_of(&copy(b"C:/project/worker.jsx"), true));
        let elsewhere = entry_point(b"/project/a\\b.js");
        assert!(elsewhere.is_source_of(&copy(b"/project/a\\b.js"), false));
        assert!(!elsewhere.is_source_of(&copy(b"/project/a/b.js"), false));
    }

    #[test]
    fn public_path_outside_prefix_is_unchanged() {
        let (files, entries) = collect_output_files(
            vec![entry(b"/project/a.ts", b"/project/a.ts")],
            &EntryPointNames {
                module_prefix: PREFIX,
                shown: &names(&["a.ts"]),
                embedded: &names(&["a.js"]),
            },
            Vec::new(),
        );
        assert_eq!(&*files[0].dest_path, b"/project/a.ts");
        assert_eq!(entries[0].source_path, b"/project/a.ts");
    }
}
