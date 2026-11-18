//! ResolveExport, without recursion.

use bun_engine_macros::Trace;
use bun_engine_text::{Identifier, PropertyName, names, private_names};

use crate::heap::{RootMap, RootSet};
use crate::{
    AbstractModuleRecord, Cx, ErrorType, ExportSource, FastHashSet, Gc, JsResult, RootVec, errors,
    root_vec,
};

/// The ResolvedBinding Record of ECMA-262.
#[derive(Clone, PartialEq, Eq, Trace)]
#[repr(C)]
pub struct ResolvedBinding {
    pub module: Gc<AbstractModuleRecord>,
    /// `@starNamespace` for the namespace object.
    pub name: Identifier,
}

impl ResolvedBinding {
    fn new(module: Gc<AbstractModuleRecord>, name: &Identifier) -> ResolvedBinding {
        let name = name.clone();
        ResolvedBinding { module, name }
    }

    fn namespace_of(module: Gc<AbstractModuleRecord>) -> ResolvedBinding {
        let name = private_names::starNamespace.to_identifier();
        ResolvedBinding { module, name }
    }

    pub fn is_namespace(&self) -> bool {
        self.name == private_names::starNamespace
    }

    pub fn is_live(&self) -> bool {
        self.module.has_live_exports() && !self.is_namespace()
    }
}

pub enum Resolution {
    Resolved(ResolvedBinding),
    NotFound,
    Ambiguous,
    /// `default`, which `export *` does not provide.
    NoDefault,
}

#[derive(Clone, Copy, PartialEq)]
enum Step {
    Ask,
    AskThroughStar,
    /// Falls back on the star exports if the indirect export has led nowhere.
    EndIndirect,
    EndStars,
}

struct Search {
    steps: RootVec<(Step, Gc<AbstractModuleRecord>, Identifier)>,
    /// One for each call that a recursive search would be in.
    results: RootVec<Option<ResolvedBinding>>,
    resolve_set: RootSet<(Gc<AbstractModuleRecord>, Identifier)>,
    /// From then on what a module answers depends on the way that led to it.
    has_seen_stars: bool,
    first_live_module_behind_star: Option<ResolvedBinding>,
}

impl Search {
    /// The first `export *` that provides a live export wins.
    fn merge(&mut self, found: ResolvedBinding) -> Result<(), Resolution> {
        let result = self.results.last_mut().expect("the outermost is left");
        match result {
            None => *result = Some(found),
            Some(earlier) if *earlier == found || earlier.is_live() || found.is_live() => {}
            Some(_) => return Err(Resolution::Ambiguous),
        }
        Ok(())
    }

    fn ask_stars(
        &mut self,
        module: Gc<AbstractModuleRecord>,
        name: &Identifier,
    ) -> Result<(), Resolution> {
        if *name == names::default {
            return Err(Resolution::NoDefault);
        }
        self.has_seen_stars = true;
        self.steps.push((Step::EndStars, module, name.clone()));
        self.results.push(None);
        for star in module.entries().star_exports().iter().rev() {
            let imported = module.imported_module(star.borrow());
            (self.steps).extend(imported.map(|it| (Step::AskThroughStar, it, name.clone())));
        }
        Ok(())
    }

    fn ask(
        &mut self,
        cx: &Cx,
        step: Step,
        module: Gc<AbstractModuleRecord>,
        name: Identifier,
    ) -> Result<(), Resolution> {
        let entries = module.entries();
        let export = entries.find_export(name.name());
        if module.has_live_exports() {
            let binding = ResolvedBinding::new(module, &name);
            if step == Step::Ask || export.is_some() {
                return self.merge(binding);
            }
            self.first_live_module_behind_star.get_or_insert(binding);
        }
        if !self.resolve_set.insert((module, name.clone())) {
            return Ok(());
        }
        self.has_seen_stars |= !entries.star_exports().is_empty();
        match export.map(|it| &it.source) {
            None => self.ask_stars(module, &name),
            Some(ExportSource::Local(local)) => self.merge(ResolvedBinding::new(module, local)),
            Some(ExportSource::Namespace(request)) => {
                let imported = module.imported_module(request.borrow());
                imported.map_or(Ok(()), |it| self.merge(ResolvedBinding::namespace_of(it)))
            }
            Some(ExportSource::Indirect {
                module: request,
                imported,
            }) => {
                if !self.has_seen_stars
                    && let Some(binding) = module.remembered_resolution(cx, name.name())
                {
                    return self.merge(binding);
                }
                self.steps.push((Step::EndIndirect, module, name));
                self.results.push(None);
                let next = module.imported_module(request.borrow());
                (self.steps).extend(next.map(|it| (Step::Ask, it, imported.clone())));
                Ok(())
            }
        }
    }

    fn run(&mut self, cx: &mut Cx) -> Result<Option<ResolvedBinding>, Resolution> {
        while let Some((step, module, name)) = self.steps.pop() {
            if let Step::Ask | Step::AskThroughStar = step {
                self.ask(cx, step, module, name)?;
                continue;
            }
            match (step, self.results.pop().flatten()) {
                (Step::EndIndirect, None) => self.ask_stars(module, &name)?,
                (Step::EndIndirect, Some(binding)) => {
                    if !self.has_seen_stars {
                        module.remember_resolution(cx, name, binding.clone());
                    }
                    self.merge(binding)?;
                }
                (_, Some(_)) if module.has_live_exports() => {
                    self.merge(ResolvedBinding::new(module, &name))?;
                }
                (_, Some(binding)) => self.merge(binding)?,
                (_, None) => {}
            }
        }
        let result = self.results.pop().flatten();
        Ok(result.or_else(|| self.first_live_module_behind_star.take()))
    }
}

impl AbstractModuleRecord {
    fn remembered_resolution(&self, cx: &Cx, name: PropertyName<'_>) -> Option<ResolvedBinding> {
        self.resolutions().borrow(cx).get(&name).cloned()
    }

    fn remember_resolution(&self, cx: &mut Cx, name: Identifier, binding: ResolvedBinding) {
        let mut resolutions = self.resolutions().borrow_mut(cx);
        resolutions.entry(name).or_insert(binding);
    }

    /// ResolveExport
    pub fn resolve_export(&self, cx: &mut Cx, name: &Identifier) -> Resolution {
        let this = Gc::from(self);
        if self.has_live_exports() {
            return Resolution::Resolved(ResolvedBinding::new(this, name));
        }
        match self.entries().find_export(name.name()).map(|it| &it.source) {
            Some(ExportSource::Local(local)) => {
                return Resolution::Resolved(ResolvedBinding::new(this, local));
            }
            Some(ExportSource::Namespace(request)) => {
                let imported = self.imported_module(request.borrow());
                let binding = imported.map(ResolvedBinding::namespace_of);
                return binding.map_or(Resolution::NotFound, Resolution::Resolved);
            }
            _ => {}
        }
        if let Some(binding) = self.remembered_resolution(cx, name.name()) {
            return Resolution::Resolved(binding);
        }
        let mut search = Search {
            steps: root_vec(),
            results: root_vec(),
            resolve_set: RootSet::default(),
            has_seen_stars: false,
            first_live_module_behind_star: None,
        };
        search.steps.push((Step::Ask, this, name.clone()));
        search.results.push(None);
        match search.run(cx) {
            Ok(Some(binding)) => {
                self.remember_resolution(cx, name.clone(), binding.clone());
                Resolution::Resolved(binding)
            }
            Ok(None) => Resolution::NotFound,
            Err(failure) => failure,
        }
    }

    /// `first` and the modules that `export *` leads to from them, each once.
    fn for_each_behind_stars(
        mut pending: RootVec<Gc<AbstractModuleRecord>>,
        mut visit: impl FnMut(Gc<AbstractModuleRecord>),
    ) {
        let mut visited = RootSet::default();
        while let Some(module) = pending.pop() {
            if visited.insert(module) {
                visit(module);
                let entries = module.entries();
                let stars = entries.star_exports().iter();
                pending.extend(stars.filter_map(|star| module.imported_module(star.borrow())));
            }
        }
    }

    /// The unambiguous names of GetExportedNames, with what they resolve to. A name for which there is just one
    /// binding in all the modules that are in question needs no search.
    pub(super) fn resolve_all_exports(
        &self,
        cx: &mut Cx,
    ) -> JsResult<RootVec<(Identifier, ResolvedBinding)>> {
        let mut resolved = root_vec();
        if self.has_live_exports() {
            return Ok(resolved);
        }
        let own_entries = self.entries();
        let mut unique = RootMap::<Identifier, ResolvedBinding>::default();
        let mut to_search = FastHashSet::<Identifier>::default();
        let (mut root, mut live_modules) = (root_vec(), root_vec());
        root.push(Gc::from(self));
        Self::for_each_behind_stars(root, |module| {
            let (is_root, entries) = (module.is_same(self), module.entries());
            if module.has_live_exports() && !entries.star_exports().is_empty() {
                live_modules.push(module);
            }
            for export in entries.exports() {
                let name = &export.exported;
                if !is_root
                    && (*name == names::default
                        || own_entries.find_export(name.name()).is_some()
                        || to_search.contains(name))
                {
                    continue;
                }
                let binding = match &export.source {
                    _ if module.has_live_exports() => ResolvedBinding::new(module, name),
                    ExportSource::Local(local) => ResolvedBinding::new(module, local),
                    ExportSource::Namespace(request) => {
                        match module.imported_module(request.borrow()) {
                            Some(imported) => ResolvedBinding::namespace_of(imported),
                            None => continue,
                        }
                    }
                    ExportSource::Indirect { .. } => {
                        unique.remove(name);
                        to_search.insert(name.clone());
                        continue;
                    }
                };
                if is_root {
                    resolved.push((name.clone(), binding));
                } else if (unique.insert(name.clone(), binding.clone()))
                    .is_some_and(|earlier| earlier != binding)
                {
                    unique.remove(name);
                    to_search.insert(name.clone());
                }
            }
        });
        // What comes by way of a module with live exports is one of those.
        Self::for_each_behind_stars(live_modules, |module| {
            for export in module.entries().exports() {
                if unique.remove(&export.exported).is_some() {
                    to_search.insert(export.exported.clone());
                }
            }
        });
        for (name, binding) in unique {
            self.remember_resolution(cx, name.clone(), binding.clone());
            resolved.push((name, binding));
        }
        for name in to_search {
            match self.resolve_export(cx, &name) {
                Resolution::Resolved(binding) => resolved.push((name, binding)),
                Resolution::Ambiguous => {}
                Resolution::NotFound if self.is_typescript().get() => {}
                Resolution::NotFound => {
                    return Err(errors::throw_naming(
                        cx,
                        ErrorType::SyntaxError,
                        "Exported binding name '",
                        name.name(),
                        "' is not found.",
                        "Exported binding name is not found.",
                    ));
                }
                Resolution::NoDefault => {
                    return Err(cx.throw_syntax_error(
                        "Exported binding name 'default' cannot be resolved by star export entries.",
                    ));
                }
            }
        }
        Ok(resolved)
    }
}
