use core::mem::take;
use core::ops::Range;

use bun_sema::bind::{Binding, ClassOwner, Decl, FnOwner, Parent, PrivateNameId, SymbolId};
use bun_sema::hir::{
    self, BinOp, ClassId, ExprId, ExprKind, Flags, FnId, MemberId, MemberKey, MemberKind, PatKind,
    PropKey, StmtId, StmtKind, UnOp, VarKind,
};
use rustc_hash::FxHashSet;
use smallvec::smallvec;

use super::{FileScan, Interest, Part, TOP_LEVEL};
use crate::modules::ModuleRef;

impl FileScan<'_, '_> {
    // A unit for each function that code comes by in one way alone, which a binding shows: through a variable that nothing else is stored to, or under a private name.
    // What is stored under any other key waits for nothing. A value may name the key: a computed key, a list of names that a built-in takes, the names that a module of WebAssembly imports.
    // One such key in reached code stands for all of them, and every program of any size has one.
    // A function that goes somewhere as a value where it is written is code of the region around it.
    pub(super) fn collect_function_units(&mut self, has_decorators: bool) {
        let (hir, bound) = (self.hir, self.bound);
        let places_of_several = self.find_places_of_several_functions();
        if !has_decorators {
            for class in (0..hir.classes.len() as u32).map(ClassId) {
                self.add_units_of_class(class, &places_of_several);
            }
        }
        // A reference outside the block finds such a function in a second variable.
        let hoisted = bound.runtime.annex_b_functions().iter();
        let hoisted: FxHashSet<FnId> = hoisted.map(|it| it.function).collect();
        for function in (0..hir.fns.len() as u32).map(FnId) {
            let func = &hir[function];
            if !hir::has_body(func)
                || func.flags.contains(Flags::AMBIENT)
                || self.units.unit_of_function.contains_key(&function)
                || self.units.inner_modules.contains_key(&function)
                || (self.find_place_of_function(function))
                    .is_some_and(|place| places_of_several.contains(&place))
            {
                continue;
            }
            match bound.fns[function.idx()].owner {
                FnOwner::Stmt(statement) if !hoisted.contains(&function) => {
                    self.add_declared_function(function, statement);
                }
                FnOwner::Expr(expression) => self.add_function_expression(function, expression),
                FnOwner::Stmt(_) | FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => {}
            }
        }
    }

    // Where the text of the function stands, as a unit of it would be placed.
    fn find_place_of_function(&self, function: FnId) -> Option<(u32, u32)> {
        let hir = self.hir;
        match self.bound.fns[function.idx()].owner {
            FnOwner::Expr(expression) => Some((hir[expression].pos, hir[expression].end)),
            FnOwner::Stmt(statement) => Some((hir[statement].loc.pos, hir[statement].loc.end)),
            FnOwner::Member(member) => Some((hir[member].loc.pos, hir[member].loc.end)),
            FnOwner::None | FnOwner::Type(_) => None,
        }
    }

    // What the build writes in the place of a call holds several functions at the place of the call: one for each file that `import.meta.glob(..)` finds.
    // Regions go by the text, which does not tell such functions apart, so they are code of the region around them.
    fn find_places_of_several_functions(&self) -> FxHashSet<(u32, u32)> {
        let mut places: FxHashSet<(u32, u32)> = FxHashSet::default();
        let functions = (0..self.hir.fns.len() as u32).map(FnId);
        functions
            .filter_map(|function| self.find_place_of_function(function))
            .filter(|&place| !places.insert(place))
            .collect()
    }

    // The pieces are linked by now.
    pub(super) fn place_units(&mut self) {
        for (unit, position) in take(&mut self.units_placed_by_text) {
            let around = self.region_outside(position, Some(unit));
            self.units.units[unit as usize].region_around = around;
        }
    }

    // `around`: the region whose code makes the function, where that is another one than the region it is written in.
    fn add_function(&mut self, function: FnId, written_at: Range<u32>, around: Option<u32>) -> u32 {
        let unit = self.add_unit(Part::Bodies, smallvec![function]);
        self.units.unit_of_function.insert(function, unit);
        match around {
            Some(around) => self.units.units[unit as usize].region_around = around,
            None => self.units_placed_by_text.push((unit, written_at.start)),
        }
        self.add_piece(written_at, unit);
        unit
    }

    fn find_unit_of_private_name(&self, name: PrivateNameId) -> Option<u32> {
        self.units_of_private_names.get(&name).copied()
    }

    // `const name = value`, where nothing else is ever stored to the name.
    fn find_variable_initialized_with(&self, value: ExprId) -> Option<SymbolId> {
        let (_, Parent::VarInit(declaration)) = self.find_parent(value) else {
            return None;
        };
        let node = &self.hir[declaration];
        let is_plain = matches!(node.kind, VarKind::Var | VarKind::Let | VarKind::Const)
            && matches!(self.hir[node.pat].kind, PatKind::Ident(_))
            && !node.flags.contains(Flags::AMBIENT);
        match self.bound.initialized_binding(node.pat) {
            Binding::Symbol(symbol) if is_plain && self.is_stable(symbol) => Some(symbol),
            _ => None,
        }
    }

    // A namespace stores the functions and classes that it exports in its object, where they are declared. Whoever has the object finds them there.
    fn is_in_variable_alone(&self, symbol: SymbolId) -> bool {
        self.is_stable(symbol)
            && self.bound.export_symbol_of_value_symbol_if_exported(symbol) == symbol
    }

    fn find_variable_of_class(&self, class: ClassId) -> Option<SymbolId> {
        match self.bound.class_owner[class.idx()] {
            ClassOwner::Stmt(_) => {
                let symbol = self.bound.declared_symbol(Decl::Class(class));
                self.is_in_variable_alone(symbol).then_some(symbol)
            }
            ClassOwner::Expr(expression) => self.find_variable_initialized_with(expression),
        }
    }

    // The private name that alone leads to the function of a member. Every other member stays with its class.
    pub(super) fn find_private_name_of_function(&self, member: MemberId) -> Option<PrivateNameId> {
        let (hir, node) = (self.hir, &self.hir[member]);
        if node.func.is_none() || !hir::has_body(&hir[node.func]) {
            return None;
        }
        match (node.kind, hir.runtime_member_key(member)) {
            (MemberKind::Method | MemberKind::Getter | MemberKind::Setter, PropKey::Private(_)) => {
                self.bound.private_name_of_member(member)
            }
            _ => None,
        }
    }

    fn add_units_of_class(&mut self, class: ClassId, places_of_several: &FxHashSet<(u32, u32)>) {
        let (hir, bound) = (self.hir, self.bound);
        if hir[class].flags.contains(Flags::AMBIENT) || bound.class_scope[class.idx()].is_none() {
            return;
        }
        if !self.units.unit_of_class.contains_key(&class)
            && let Some(variable) = self.find_variable_of_class(class)
            && !self.units.unit_of_symbol.contains_key(&variable)
        {
            self.add_class_unit(class);
            if let Some(&unit) = self.units.unit_of_class.get(&class) {
                let position = hir[class].text_start;
                self.units_placed_by_text.push((unit, position));
            }
        }
        // Whoever calls a method has got hold of the class or of an object of it.
        let around = self.units.unit_of_class.get(&class).map(|&unit| unit + 1);
        for member in hir[class].members.iter() {
            let Some(name) = self.find_private_name_of_function(member) else {
                continue;
            };
            let node = &hir[member];
            let written_at = node.loc.pos..node.loc.end;
            if places_of_several.contains(&(written_at.start, written_at.end)) {
                continue;
            }
            // A getter and a setter share the name.
            match self.find_unit_of_private_name(name) {
                Some(unit) => {
                    self.units.units[unit as usize].functions.push(node.func);
                    self.units.unit_of_function.insert(node.func, unit);
                    self.add_piece(written_at, unit);
                }
                None => {
                    let unit = self.add_function(node.func, written_at, around);
                    self.units_of_private_names.insert(name, unit);
                }
            }
        }
    }

    fn add_declared_function(&mut self, function: FnId, statement: StmtId) {
        let symbol = self.bound.declared_symbol(Decl::Fn(function));
        let is_declaration =
            matches!(self.hir[statement].kind, StmtKind::Fn(declared) if declared == function);
        if is_declaration
            && self.is_in_variable_alone(symbol)
            && !self.units.unit_of_symbol.contains_key(&symbol)
        {
            let written_at = self.hir[statement].loc;
            self.add_function(function, written_at.pos..written_at.end, None);
        }
    }

    // What a literal, an assignment or an initializer of a field stores is a property of an object, so such a function is code of the region around it.
    fn add_function_expression(&mut self, function: FnId, expression: ExprId) {
        let written_at = self.hir[expression].pos..self.hir[expression].end;
        if let Some(variable) = self.find_variable_initialized_with(expression)
            && !self.units.unit_of_symbol.contains_key(&variable)
        {
            self.add_function(function, written_at, None);
        }
    }

    // `x instanceof C`, `typeof C`
    pub(super) fn is_only_compared(&self, reference: ExprId) -> bool {
        let (outermost, Parent::Expr(parent)) = self.find_parent(reference) else {
            return false;
        };
        match self.hir[parent].kind {
            ExprKind::Binary {
                op: BinOp::Instanceof,
                right,
                ..
            } => right == outermost,
            ExprKind::Unary {
                op: UnOp::Typeof, ..
            } => true,
            _ => false,
        }
    }

    // `class D extends C`: the definition of `D` needs `C` to be there. What `C` holds is for whoever gets hold of `D`.
    // The unit of `D`, and what the definition needs.
    pub(super) fn split_interest_of_heritage(
        &self,
        reference: ExprId,
        interest: Interest,
    ) -> Option<(u32, Option<Interest>)> {
        let (_, Parent::ClassExtends(extending)) = self.find_parent(reference) else {
            return None;
        };
        let &unit = self.units.unit_of_class.get(&extending)?;
        match interest {
            Interest::Unit(extended) => {
                let is_class = self.units.units[extended as usize].is_class;
                is_class.then_some((unit, None))
            }
            Interest::Binding(defined) => Some((unit, Some(Interest::TestedBinding(defined)))),
            Interest::TestedBinding(_)
            | Interest::CalledBinding(..)
            | Interest::Evaluation(_)
            | Interest::Require { .. }
            | Interest::AnswerOfLoader(_)
            | Interest::Request(_)
            | Interest::Star(_)
            | Interest::UsedImport(_)
            | Interest::HandedOnNamespace(_)
            | Interest::RequiredName(..)
            | Interest::Export(..)
            | Interest::CalledExport(..)
            | Interest::EveryExport(_)
            | Interest::Name(..)
            | Interest::CalledName(..)
            | Interest::LinkedName(..)
            | Interest::ModuleObject(..)
            | Interest::EntryOfModuleCache
            | Interest::LoadByUnknownName
            | Interest::NameReadFromLoadByUnknownName(_)
            | Interest::LoadOfIsolatedCode
            | Interest::FileSpelled(_)
            | Interest::KnownMember(_)
            | Interest::KnownVariable(_)
            | Interest::Lookup(_)
            | Interest::HandedOnObject(_)
            | Interest::Piece(_)
            | Interest::StoreOfLoaderFunction(_) => None,
        }
    }

    fn holds_code_of(&self, module: ModuleRef) -> bool {
        match module {
            ModuleRef::File(file) | ModuleRef::Face(file) | ModuleRef::Inner { file, .. } => {
                file == self.file
            }
            ModuleRef::Check(_) | ModuleRef::Runtime(_) | ModuleRef::External { .. } => false,
        }
    }

    // Whether the file does without a declaration where nothing has the interest.
    pub(super) fn keeps_declaration_of_file(&self, interest: Interest) -> bool {
        match interest {
            Interest::Unit(unit) | Interest::Piece(unit) => {
                match self.units.units[unit as usize].part {
                    Part::Bodies => false,
                    Part::Declarator(_)
                    | Part::Class(_)
                    | Part::Statement(_)
                    | Part::InnerModule(_) => true,
                }
            }
            Interest::Binding(defined)
            | Interest::TestedBinding(defined)
            | Interest::CalledBinding(defined, _)
            | Interest::KnownMember(defined)
            | Interest::KnownVariable(defined)
            | Interest::Lookup(defined)
            | Interest::HandedOnObject(defined) => defined.file == self.file,
            // The statements of the body that store under the name.
            Interest::Name(export, accessed)
            | Interest::CalledName(export, accessed)
            | Interest::LinkedName(export, accessed) => {
                let owner = self.input.graph.synthetic_export(export).module;
                self.holds_code_of(owner) || self.holds_code_of(accessed)
            }
            Interest::Export(module, _)
            | Interest::CalledExport(module, _)
            | Interest::EveryExport(module) => self.holds_code_of(module),
            // These run a body, or ask something of the loader. None of them names a declaration.
            Interest::Evaluation(_)
            | Interest::Require { .. }
            | Interest::AnswerOfLoader(_)
            | Interest::Request(_)
            | Interest::Star(_)
            | Interest::UsedImport(_)
            | Interest::HandedOnNamespace(_)
            | Interest::RequiredName(..)
            | Interest::ModuleObject(..)
            | Interest::EntryOfModuleCache
            | Interest::LoadByUnknownName
            | Interest::NameReadFromLoadByUnknownName(_)
            | Interest::LoadOfIsolatedCode
            | Interest::FileSpelled(_)
            | Interest::StoreOfLoaderFunction(_) => false,
        }
    }

    // A function that stays captures what the functions written in it name, also for one of them that is left out.
    // So a variable that one of them names is declared as long as the outermost function around them stays.
    pub(super) fn region_below_body(&self, mut region: u32) -> u32 {
        while region != TOP_LEVEL {
            let around = self.units.units[region as usize - 1].region_around;
            if self.units.find_module_with_body(around).is_some() {
                break;
            }
            region = around;
        }
        region
    }

    // `this.#name`
    pub(super) fn add_private_name_of_access(&mut self, access: ExprId) {
        if let Some((_, MemberKey::PrivateName(_))) = self.hir.member_key(access)
            && let Some(name) = self.bound.private_name_of_reference(access)
            && let Some(unit) = self.find_unit_of_private_name(name)
        {
            self.add_interest(self.hir[access].pos, Interest::Unit(unit));
        }
    }
}

