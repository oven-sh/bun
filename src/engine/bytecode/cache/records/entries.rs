use std::rc::Rc;

use bun_engine_syntax::LineTable;

use super::{Decoder, Place, Root, Target, Writer, optional};
use crate::bytes::Reader;
use crate::cache::Key;
use crate::code::{
    CodeKind, Declarations, Directives, ExportEntry, ImportEntry, Module, ModuleRequest,
};
use crate::function::FunctionInfo;
use crate::operand::ImportPhase;
use crate::scope::{SlotKind, StaticScope};

impl Writer<'_> {
    fn lines(&mut self) {
        let text = self.source.text();
        if text.len() < LineTable::SHORTEST_TEXT_TO_PREPARE {
            return self.bytes().fixed(0);
        }
        let lines = self.require(LineTable::encode(text).ok());
        self.blob(&lines);
    }

    fn directives(&mut self, directives: &Directives) {
        for url in [&directives.source_url, &directives.source_mapping_url] {
            self.optional(url.as_ref(), |w, url| w.text(url.text()));
        }
    }

    fn declarations(&mut self, declarations: &Declarations) {
        let Declarations {
            variables,
            functions,
            hoisted_functions,
            lets,
            constants,
        } = declarations;
        for names in [variables, functions, hoisted_functions, lets, constants] {
            self.identifiers(names);
        }
    }

    fn interface(&mut self, module: &Module) {
        self.list(&module.requests, |w, request| {
            w.atom(&request.specifier);
            w.bytes().push(request.phase as u8);
            w.list(&request.attributes, |w, (key, value)| {
                w.atom(key);
                w.atom(value);
            });
        });
        self.list(&module.imports, |w, import| {
            w.bytes().number(import.request);
            w.optional(import.imported.as_ref(), Self::atom);
            w.atom(&import.local);
            w.bytes().number(import.slot);
        });
        self.list(&module.exports, |w, export| match export {
            ExportEntry::Local { exported, slot } => {
                w.bytes().push(0);
                w.atom(exported);
                w.bytes().number(*slot);
            }
            ExportEntry::Indirect {
                exported,
                request,
                imported,
            } => {
                w.bytes().push(1);
                w.atom(exported);
                w.bytes().number(*request);
                w.optional(imported.as_ref(), Self::atom);
            }
            ExportEntry::Star { request } => {
                w.bytes().push(2);
                w.bytes().number(*request);
            }
        });
    }

    pub(in crate::cache) fn entry(&mut self, root: Root<'_>, key: &Key<'_>, place: Place<'_>) {
        self.bytes().put(&key.bytes());
        if self.has_own_strings {
            self.fixup(Target::OwnStrings);
        } else {
            self.bytes().fixed(0);
        }
        self.lines();
        self.scopes.reset(None);
        self.sized(|writer| writer.root(root, place));
    }

    fn sized(&mut self, write: impl FnOnce(&mut Self)) {
        let size_at = self.bytes().len();
        self.bytes().fixed(0);
        write(self);
        if let Some((size, rest)) = self.bytes()[size_at..].split_first_chunk_mut() {
            *size = (rest.len() as u32).to_le_bytes();
        }
    }

    fn root(&mut self, root: Root<'_>, place: Place<'_>) {
        match root {
            Root::Script(script) => {
                self.directives(&script.directives);
                self.declarations(&script.declarations);
                self.code(&script.code, place);
            }
            Root::Module(module) => {
                self.directives(&module.directives);
                self.scope(&module.scope);
                self.sized(|writer| writer.interface(module));
                self.code(&module.code, place);
            }
            Root::Builtin(function) => {
                let record = self.require(place(function.clone()));
                self.fixup(Target::Record(record));
            }
        }
    }
}

impl Decoder<'_> {
    pub(in crate::cache) fn directives(&self, reader: &mut Reader<'_>) -> Option<Directives> {
        Some(Directives {
            source_url: optional(reader, |reader| self.string(reader))?,
            source_mapping_url: optional(reader, |reader| self.string(reader))?,
        })
    }

    pub(in crate::cache) fn declarations(&self, reader: &mut Reader<'_>) -> Option<Declarations> {
        Some(Declarations {
            variables: self.identifiers(reader)?,
            functions: self.identifiers(reader)?,
            hoisted_functions: self.identifiers(reader)?,
            lets: self.identifiers(reader)?,
            constants: self.identifiers(reader)?,
        })
    }

    pub(in crate::cache) fn module(
        &mut self,
        reader: &mut Reader<'_>,
        has_interface: bool,
    ) -> Option<Module> {
        let directives = self.directives(reader)?;
        let scope = self.scope(reader, true)?;
        let interface = &mut reader.section()?;
        let (requests, imports, exports) = match has_interface {
            true => self.interface(interface, &scope)?,
            false => Default::default(),
        };
        let code = self.code(reader, CodeKind::Module)?;
        let is_declared_here = |function: &FunctionInfo| {
            !function.needs_new()
                && (function.scope.as_ref()).is_some_and(|it| Rc::ptr_eq(it, &scope))
        };
        (scope.slots.iter())
            .filter(|slot| slot.kind == SlotKind::LazyFunction)
            .all(|slot| (code.functions.get(slot.detail as usize)).is_some_and(is_declared_here))
            .then_some(())?;
        Some(Module {
            code,
            scope,
            requests,
            imports,
            exports,
            has_interface,
            directives,
        })
    }

    fn interface(
        &self,
        reader: &mut Reader<'_>,
        scope: &StaticScope,
    ) -> Option<(Box<[ModuleRequest]>, Box<[ImportEntry]>, Box<[ExportEntry]>)> {
        let requests = reader.list(|reader| {
            let (specifier, phase) = (self.atom(reader)?, u32::from(reader.byte()?));
            let attributes = reader.list(|it| Some((self.atom(it)?, self.atom(it)?)))?;
            (phase < ImportPhase::COUNT).then(|| ModuleRequest {
                specifier,
                attributes,
                phase: ImportPhase::from_word(phase),
            })
        })?;
        let request = |reader: &mut Reader<'_>| {
            (reader.number()).filter(|&request| (request as usize) < requests.len())
        };
        let is_trusted = self.is_trusted();
        let slot = |reader: &mut Reader<'_>| {
            (reader.number()).filter(|&slot| is_trusted || scope.slot_at(slot).is_some())
        };
        let imports = reader.list(|reader| {
            Some(ImportEntry {
                request: request(reader)?,
                imported: optional(reader, |reader| self.atom(reader))?,
                local: self.atom(reader)?,
                slot: slot(reader)?,
            })
        })?;
        (is_trusted || are_for(&imports, scope)).then_some(())?;
        let exports = reader.list(|reader| {
            Some(match reader.byte()? {
                0 => ExportEntry::Local {
                    exported: self.atom(reader)?,
                    slot: slot(reader)?,
                },
                1 => ExportEntry::Indirect {
                    exported: self.atom(reader)?,
                    request: request(reader)?,
                    imported: optional(reader, |reader| self.atom(reader))?,
                },
                2 => ExportEntry::Star {
                    request: request(reader)?,
                },
                _ => return None,
            })
        })?;
        Some((requests, imports, exports))
    }
}

/// Whether each has the slot of its name and kind, in ascending order, and no slot for an import is left out.
fn are_for(imports: &[ImportEntry], scope: &StaticScope) -> bool {
    let has_its_slot = |import: &ImportEntry| {
        let kind = match import.imported {
            Some(_) => SlotKind::Import,
            None => SlotKind::Const,
        };
        (scope.slot_at(import.slot))
            .is_some_and(|slot| slot.kind == kind && scope.text_of(slot) == import.local.text())
    };
    let named = imports.iter().filter(|it| it.imported.is_some());
    let slots = scope.slots.iter().filter(|it| it.kind == SlotKind::Import);
    imports.iter().all(has_its_slot)
        && imports.is_sorted_by(|a, b| a.slot < b.slot)
        && named.count() == slots.count()
}
