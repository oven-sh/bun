use std::collections::{BTreeMap, BTreeSet};

use bstr::BStr;
use bun_core::strings;
use bun_paths::Path;

use crate::schema::{Enum, Features, File, Message, Name, Types};
use crate::{Error, Failure, Read, parser};

macro_rules! well_known_files {
    ($($name:literal),*) => {
        [$((
            concat!("google/protobuf/", $name, ".proto"),
            include_str!(concat!("well_known/", $name, ".proto")),
        )),*]
    };
}

const WELL_KNOWN_FILES: [(&str, &str); 10] = well_known_files![
    "any",
    "api",
    "duration",
    "empty",
    "field_mask",
    "source_context",
    "struct",
    "timestamp",
    "type",
    "wrappers"
];

pub(crate) const ROOT: usize = 0;

#[derive(PartialEq, Eq)]
pub(crate) enum Origin {
    Disk(Vec<u8>),
    /// No module exists for it, so what a schema uses of it is written into the module of the schema.
    WellKnown(&'static str),
}

pub(crate) struct LoadedFile {
    pub(crate) origin: Origin,
    /// Empty for [`ROOT`], whose text the caller has.
    text: Vec<u8>,
    pub(crate) schema: File,
    /// The file that each of `schema.imports` names, if it was found. Empty if they were not looked up.
    imports: Vec<Option<usize>>,
}

fn locate(index: usize, origin: &Origin, text: &[u8], failure: Failure) -> Error {
    let path = match origin {
        Origin::Disk(path) => path.as_slice(),
        Origin::WellKnown(name) => name.as_bytes(),
    };
    Error {
        message: failure.message,
        start: failure.span.start,
        len: failure.span.len,
        imported_file: (index != ROOT).then(|| (path.to_vec(), text.to_vec())),
    }
}

/// protoc looks an import up in its `-I` directories. Every directory above the importer stands in for them.
fn find_import(
    importer: &Origin,
    import: &Name,
    read: &dyn Fn(&[u8]) -> Read,
) -> Result<Option<(Origin, Vec<u8>)>, Failure> {
    let name = import.text.as_bytes();
    if let Origin::Disk(importer) = importer
        && bun_paths::is_absolute(importer)
        && !bun_paths::is_absolute(name)
        && !strings::contains_char(name, 0)
    {
        for directory in bun_paths::ancestors(importer).skip(1) {
            let path = Path::join(&[directory, name]).as_bytes().to_vec();
            if path == *importer {
                continue;
            }
            match read(&path) {
                Ok(Some(text)) => return Ok(Some((Origin::Disk(path), text))),
                Ok(None) => {}
                Err(reason) => {
                    let (path, reason) = (BStr::new(&path), BStr::new(reason));
                    let message = format!("Cannot read \"{path}\": {reason}");
                    return Err(Failure::new(import.span, message));
                }
            }
        }
    }
    let well_known = WELL_KNOWN_FILES.iter().find(|it| it.0 == import.text);
    Ok(well_known.map(|(name, text)| (Origin::WellKnown(name), text.as_bytes().to_vec())))
}

pub(crate) fn load(
    path: &[u8],
    text: &[u8],
    read: &dyn Fn(&[u8]) -> Read,
) -> Result<Vec<LoadedFile>, Error> {
    let origin = Origin::Disk(path.to_vec());
    let schema = parser::parse(text).map_err(|failure| locate(ROOT, &origin, text, failure))?;
    let mut files = vec![LoadedFile {
        origin,
        text: Vec::new(),
        schema,
        imports: Vec::new(),
    }];
    let mut next = ROOT;
    while next < files.len() {
        let is_well_known = matches!(files[next].origin, Origin::WellKnown(_));
        let is_emitted = next == ROOT || is_well_known;
        let importer = if is_well_known { ROOT } else { next };
        let mut imports = Vec::new();
        for index in 0..files[next].schema.imports.len() {
            let import = &files[next].schema.imports[index];
            let found = match is_emitted || import.is_public {
                true => find_import(&files[importer].origin, &import.path, read),
                false => Ok(None),
            };
            let LoadedFile { origin, text, .. } = &files[next];
            let found = found.map_err(|failure| locate(next, origin, text, failure))?;
            let Some((origin, text)) = found else {
                imports.push(None);
                continue;
            };
            if let Some(loaded) = files.iter().position(|file| file.origin == origin) {
                imports.push(Some(loaded));
                continue;
            }
            let schema = parser::parse(&text)
                .map_err(|failure| locate(files.len(), &origin, &text, failure))?;
            imports.push(Some(files.len()));
            files.push(LoadedFile {
                origin,
                text,
                schema,
                imports: Vec::new(),
            });
        }
        files[next].imports = imports;
        next += 1;
    }
    Ok(files)
}

#[derive(Clone, Copy)]
pub(crate) enum Declaration<'a> {
    Message(&'a Message),
    Enum(&'a Enum),
    Service,
}

pub(crate) struct Symbol<'a> {
    pub(crate) file: usize,
    pub(crate) full_name: String,
    /// What the module of `file` exports it as.
    pub(crate) export_name: String,
    pub(crate) declaration: Declaration<'a>,
    /// No feature is `None`.
    pub(crate) features: Features,
}

pub(crate) struct Program<'a> {
    pub(crate) files: &'a [LoadedFile],
    /// In the order of the files, then of the declarations.
    pub(crate) symbols: Vec<Symbol<'a>>,
    by_full_name: BTreeMap<String, usize>,
    packages: BTreeSet<&'a str>,
}

pub(crate) fn qualify(scope: &str, name: &str) -> String {
    match scope.is_empty() {
        true => name.to_owned(),
        false => format!("{scope}.{name}"),
    }
}

/// Appends `$`, which no name of a schema has, until `name` is not `taken`, and takes it.
pub(crate) fn take_unique(taken: &mut BTreeSet<String>, mut name: String) -> String {
    while taken.contains(&name) {
        name.push('$');
    }
    taken.insert(name.clone());
    name
}

struct Scope<'s> {
    file: usize,
    full_name: &'s str,
    export_prefix: &'s str,
    features: Features,
}

impl<'a> Program<'a> {
    pub(crate) fn new(files: &'a [LoadedFile]) -> Result<Program<'a>, Error> {
        let mut program = Program {
            files,
            symbols: Vec::new(),
            by_full_name: BTreeMap::new(),
            packages: BTreeSet::new(),
        };
        for (index, file) in files.iter().enumerate() {
            let mut package = file.schema.package.as_str();
            while !package.is_empty() {
                program.packages.insert(package);
                let dot = strings::last_index_of_char(package.as_bytes(), b'.');
                package = &package[..dot.unwrap_or(0)];
            }
            let scope = Scope {
                file: index,
                full_name: &file.schema.package,
                export_prefix: "",
                features: file.schema.features,
            };
            let mut exports = BTreeSet::new();
            program.declare_types(&file.schema.types, &scope, &mut exports)?;
            for service in &file.schema.services {
                let (declaration, features) = (Declaration::Service, Features::default());
                program.declare(&service.name, declaration, features, &scope, &mut exports)?;
            }
        }
        Ok(program)
    }

    pub(crate) fn error(&self, file: usize, failure: Failure) -> Error {
        let loaded = &self.files[file];
        locate(file, &loaded.origin, &loaded.text, failure)
    }

    fn declare(
        &mut self,
        name: &Name,
        declaration: Declaration<'a>,
        features: Features,
        scope: &Scope<'_>,
        exports: &mut BTreeSet<String>,
    ) -> Result<(), Error> {
        let full_name = qualify(scope.full_name, &name.text);
        let earlier = (self.by_full_name).insert(full_name.clone(), self.symbols.len());
        if earlier.is_some() {
            let message = format!("\"{full_name}\" is already defined");
            return Err(self.error(scope.file, Failure::new(name.span, message)));
        }
        self.symbols.push(Symbol {
            file: scope.file,
            full_name,
            export_name: take_unique(exports, format!("{}{}", scope.export_prefix, name.text)),
            declaration,
            features: features.inside(scope.features),
        });
        Ok(())
    }

    fn declare_types(
        &mut self,
        types: &'a Types,
        scope: &Scope<'_>,
        exports: &mut BTreeSet<String>,
    ) -> Result<(), Error> {
        for it in &types.enums {
            self.declare(&it.name, Declaration::Enum(it), it.features, scope, exports)?;
        }
        for it in &types.messages {
            let declaration = Declaration::Message(it);
            self.declare(&it.name, declaration, it.features, scope, exports)?;
        }
        // After their siblings, so that `A_B` keeps its name where `A.B` exists too.
        for it in &types.messages {
            let nested = Scope {
                file: scope.file,
                full_name: &qualify(scope.full_name, &it.name.text),
                export_prefix: &format!("{}{}_", scope.export_prefix, it.name.text),
                features: it.features.inside(scope.features),
            };
            self.declare_types(&it.nested, &nested, exports)?;
        }
        Ok(())
    }

    /// `DescriptorBuilder::LookupSymbolNoPlaceholder` in protobuf's descriptor.cc.
    fn look_up(&self, mut scope: &str, name: &str) -> Option<usize> {
        if let Some(full_name) = name.strip_prefix('.') {
            return self.by_full_name.get(full_name).copied();
        }
        let first_dot = strings::index_of_char_usize(name.as_bytes(), b'.');
        let first_part = &name[..first_dot.unwrap_or(name.len())];
        loop {
            let candidate = qualify(scope, first_part);
            let symbol = self.by_full_name.get(&candidate).copied();
            if first_dot.is_none() {
                let is_type =
                    |&it: &usize| !matches!(self.symbols[it].declaration, Declaration::Service);
                if let Some(symbol) = symbol.filter(is_type) {
                    return Some(symbol);
                }
            } else if symbol.is_some() || self.packages.contains(candidate.as_str()) {
                return self.by_full_name.get(&qualify(scope, name)).copied();
            }
            if scope.is_empty() {
                return None;
            }
            scope = &scope[..strings::last_index_of_char(scope.as_bytes(), b'.').unwrap_or(0)];
        }
    }

    /// The index in `symbols` of what `name` means inside the declaration `scope` of `file`.
    pub(crate) fn resolve(&self, file: usize, scope: &str, name: &Name) -> Result<usize, Error> {
        self.look_up(scope, &name.text).ok_or_else(|| {
            let mut message = format!("\"{}\" is not defined", name.text);
            let loaded = &self.files[file];
            let imports = loaded.schema.imports.iter().zip(&loaded.imports);
            for (import, _) in imports.filter(|(_, found)| found.is_none()) {
                message.push_str(&format!(
                    ". \"{}\" is not in the directory of this file or in one above it",
                    import.path.text
                ));
            }
            self.error(file, Failure::new(name.span, message))
        })
    }

    /// The files that [`ROOT`] forwards with `import public`.
    pub(crate) fn public_imports(&self) -> Vec<usize> {
        let mut found = vec![ROOT];
        let mut next = 0;
        while let Some(&file) = found.get(next) {
            let loaded = &self.files[file];
            for (import, &target) in loaded.schema.imports.iter().zip(&loaded.imports) {
                if let Some(target) = target.filter(|it| import.is_public && !found.contains(it)) {
                    found.push(target);
                }
            }
            next += 1;
        }
        found.split_off(1)
    }

    /// What the module of [`ROOT`] imports the module of `file` by. `None` if `file` has no module.
    pub(crate) fn specifier_of(&self, file: usize) -> Option<Vec<u8>> {
        let (Origin::Disk(root), Origin::Disk(path)) =
            (&self.files[ROOT].origin, &self.files[file].origin)
        else {
            return None;
        };
        let specifier = Path::relative(bun_paths::dirname(root)?, path).into_portable();
        let specifier = specifier.as_bytes();
        Some(match specifier.starts_with(b"../") {
            true => specifier.to_vec(),
            false => [b"./", specifier].concat(),
        })
    }
}
