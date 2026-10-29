use super::answers::{
    CallTarget, CheckedType, FunctionRef, GaveUp, PositionTypes, SignatureParameter,
    SignatureShape, WrittenType,
};
use super::queries::Queries;
use crate::hir::{CallId, ClassId, ExprId, ExprKind, Flags, FnId, FnKind, TypeNodeId};
use crate::program::{FileId, Sym};
use crate::types::{MapperId, SigData, SigId, TypeId};
use smallvec::SmallVec;

const UNTYPED: PositionTypes = PositionTypes {
    written: WrittenType::Unwritten,
    checked: Ok(TypeId::ANY),
};

fn is_construct_signature(kind: FnKind) -> bool {
    matches!(
        kind,
        FnKind::Constructor | FnKind::ConstructSignature | FnKind::ConstructorType
    )
}

fn promises_nothing(written_form: TypeId) -> bool {
    written_form == TypeId::UNKNOWN
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn compute_resolved_call(
        &mut self,
        call: ExprId,
    ) -> Result<Option<CallTarget>, GaveUp> {
        let hir = self.hir();
        let (ExprKind::Call(site) | ExprKind::New(site) | ExprKind::TaggedTemplate(site)) =
            hir[call].kind
        else {
            return Ok(None);
        };
        let found = self.c.resolved_signature(self.file, call);
        let Some(signature) = found.sig else {
            return match found.ret == TypeId::UNRESOLVED {
                true => Err(GaveUp::Unresolved),
                false => Ok(None),
            };
        };
        let declaration = self
            .c
            .sig_decl(signature)
            .map(|(file, function, _)| FunctionRef { file, function });
        let checked = self.resolved(found.ret);
        let is_construction = matches!(hir[call].kind, ExprKind::New(_));
        let called = self.skip_optional_call_clone(signature);
        let result = match *self.c.types().sig(called) {
            SigData::Decl { file: of, func, .. } => {
                let declared = self.c.hir(of)[func];
                if is_construction && !is_construct_signature(declared.kind) {
                    PositionTypes::unwritten(checked)
                } else {
                    let written_mapper = self.explicit_arguments_mapper(of, func, site);
                    self.annotated_position(of, declared.ret, written_mapper, checked)
                }
            }
            SigData::Construct { class, .. } | SigData::DefaultConstruct { class, .. } => {
                PositionTypes {
                    checked,
                    ..self.class_result(class)
                }
            }
            SigData::Synth { .. } | SigData::WithReturn { .. } => PositionTypes::unwritten(checked),
        };
        Ok(Some(CallTarget {
            signature,
            declaration,
            result,
        }))
    }

    pub(super) fn compute_signature(&mut self, signature: SigId) -> SignatureShape<'c> {
        match *self.c.types().sig(signature) {
            SigData::Decl { file, func, mapper }
            | SigData::Construct {
                file, func, mapper, ..
            } => {
                let outer = self.outer_mapper(file, func, mapper);
                self.declaration_shape(file, func, outer, mapper)
            }
            SigData::DefaultConstruct { class, .. } => {
                self.default_constructor_shape(signature, class)
            }
            SigData::Synth {
                ref type_params,
                ref params,
                this,
                ..
            } => {
                let parameters: SmallVec<[SignatureParameter; 8]> = params
                    .iter()
                    .map(|parameter| SignatureParameter {
                        types: PositionTypes::unwritten(self.resolved(parameter.ty)),
                        is_optional: parameter.optional,
                        is_rest: parameter.rest,
                    })
                    .collect();
                let result = self.ask(|queries| {
                    let ty = queries.c.sig_return(signature);
                    queries.resolved(ty)
                });
                SignatureShape {
                    declaration: None,
                    this_type: this
                        .map_or(UNTYPED, |ty| PositionTypes::unwritten(self.resolved(ty))),
                    parameters: self.list(&parameters),
                    result: PositionTypes::unwritten(result),
                    has_type_parameters: !type_params.is_empty(),
                }
            }
            SigData::WithReturn { sig: inner, ret } => {
                let shape = self.signature(inner);
                match self.skip_optional_call_clone(signature) == inner {
                    true => shape,
                    false => SignatureShape {
                        result: PositionTypes::unwritten(self.resolved(ret)),
                        ..shape
                    },
                }
            }
        }
    }

    pub(super) fn compute_signature_result(&mut self, signature: SigId) -> CheckedType {
        match *self.c.types().sig(signature) {
            SigData::Decl { file, func, mapper }
            | SigData::Construct {
                file, func, mapper, ..
            } => match self.find_constructor_class(file, func) {
                Some(class) => {
                    let symbol = self.c.class_sym(file, class);
                    self.class_instance_type(symbol)
                }
                None => self.checked_result(file, func, mapper),
            },
            SigData::DefaultConstruct { class, .. } => self.class_instance_type(class),
            SigData::Synth { .. } => self.ask(|queries| {
                let ty = queries.c.sig_return(signature);
                queries.resolved(ty)
            }),
            SigData::WithReturn { sig: inner, ret } => {
                match self.skip_optional_call_clone(signature) == inner {
                    true => self.signature_result(inner),
                    false => self.resolved(ret),
                }
            }
        }
    }

    pub(super) fn find_file_of_signature(&self, signature: SigId) -> Option<FileId> {
        match *self.c.types().sig(signature) {
            SigData::Decl { file, .. } | SigData::Construct { file, .. } => Some(file),
            SigData::DefaultConstruct { .. } | SigData::Synth { .. } => None,
            SigData::WithReturn { sig: inner, .. } => self.find_file_of_signature(inner),
        }
    }

    fn checked_result(&mut self, of: FileId, func: FnId, checked_mapper: MapperId) -> CheckedType {
        self.ask(|queries| {
            let declared = queries.c.return_type_of_fn(of, func);
            let declared = queries.resolved(declared)?;
            let declared = queries.infer_result_type(of, func, declared);
            queries.instantiate_signature_type(declared, checked_mapper)
        })
    }

    pub(super) fn compute_function_signature(
        &mut self,
        function: FunctionRef,
    ) -> SignatureShape<'c> {
        self.declaration_shape(
            function.file,
            function.function,
            MapperId::IDENTITY,
            MapperId::IDENTITY,
        )
    }

    fn skip_optional_call_clone(&self, signature: SigId) -> SigId {
        match *self.c.types().sig(signature) {
            SigData::WithReturn {
                sig: inner,
                ret: TypeId::UNRESOLVED,
            } if self.c.is_optional_call_signature_of(inner) => inner,
            _ => signature,
        }
    }

    fn find_constructor_class(&self, of: FileId, func: FnId) -> Option<ClassId> {
        if self.c.hir(of)[func].kind != FnKind::Constructor {
            return None;
        }
        self.c.bound(of).function_class(func)
    }

    fn outer_mapper(&self, of: FileId, func: FnId, mapper: MapperId) -> MapperId {
        if mapper == MapperId::IDENTITY {
            return mapper;
        }
        let own_params = self.c.hir(of)[func].type_params;
        let class_params = match self.find_constructor_class(of, func) {
            Some(class) => {
                let symbol = self.c.class_sym(of, class);
                self.c.local_type_params_of_symbol(symbol)
            }
            None => SmallVec::new(),
        };
        let pairs: SmallVec<[(TypeId, TypeId); 8]> = self
            .c
            .types()
            .mapping(mapper)
            .iter()
            .copied()
            .filter(|pair| {
                !self.c.is_declared_among(pair.0, of, own_params)
                    && !class_params.contains(&pair.0)
                    && !promises_nothing(pair.1)
            })
            .collect();
        self.c.types().mapper_of(&pairs)
    }

    fn explicit_arguments_mapper(&mut self, of: FileId, func: FnId, site: CallId) -> MapperId {
        let hir = self.hir();
        let arguments = hir.list_at(hir[site].type_args);
        let parameters = self.c.hir(of)[func].type_params;
        let mut pairs: SmallVec<[(TypeId, TypeId); 4]> = SmallVec::new();
        for (parameter, argument) in parameters.iter().zip(hir.ids(arguments)) {
            if let Some(form) = self.written_type(argument).written()
                && form == self.c.type_from_node(self.file, argument)
            {
                pairs.push((self.c.type_param(of, parameter), form));
            }
        }
        self.c.types().mapper_of(&pairs)
    }

    fn instantiate_signature_type(&mut self, declared: TypeId, mapper: MapperId) -> CheckedType {
        let declared = self.resolved(declared)?;
        let ty = self.c.instantiate(declared, mapper);
        self.resolved(ty)
    }

    fn annotated_position(
        &mut self,
        of: FileId,
        node: TypeNodeId,
        written_mapper: MapperId,
        checked: CheckedType,
    ) -> PositionTypes {
        let written = self.ask_written(|queries| {
            let written = queries.compute_written_type(of, node);
            written.and_then(|ty| queries.instantiate_signature_type(ty, written_mapper))
        });
        PositionTypes { written, checked }
    }

    fn class_instance_type(&mut self, class: Sym) -> CheckedType {
        self.ask(|queries| {
            let ty = queries.c.declared_type(class);
            queries.resolved(ty)
        })
    }

    fn class_result(&mut self, class: Sym) -> PositionTypes {
        let checked = self.class_instance_type(class);
        let is_trusted = self
            .compiled_class(class)
            .is_some_and(|found| self.file_trust(found.file).is_trusted());
        let written = match is_trusted {
            true => WrittenType::from_result(checked),
            false => WrittenType::Unwritten,
        };
        PositionTypes { written, checked }
    }

    fn default_constructor_shape(&mut self, signature: SigId, class: Sym) -> SignatureShape<'c> {
        let result = self.class_result(class);
        let base = self.ask(|queries| Ok(queries.c.default_construct_base_sig(signature)));
        let parameters = match base {
            Ok(Some(base)) => self.signature(base).parameters,
            Ok(None) => self.list(&[]),
            Err(reason) => self.list(&[SignatureParameter {
                types: PositionTypes::unwritten(Err(reason)),
                is_optional: false,
                is_rest: true,
            }]),
        };
        SignatureShape {
            declaration: None,
            this_type: PositionTypes::unwritten(result.checked),
            parameters,
            result,
            has_type_parameters: !self.c.local_type_params_of_symbol(class).is_empty(),
        }
    }

    fn declaration_shape(
        &mut self,
        of: FileId,
        func: FnId,
        written_mapper: MapperId,
        checked_mapper: MapperId,
    ) -> SignatureShape<'c> {
        let hir = self.c.hir(of);
        let constructor_class = self.find_constructor_class(of, func);
        let parameters = self.signature_parameters(of, func, written_mapper, checked_mapper);
        let this_type = self.signature_this_type(of, func, written_mapper, checked_mapper);
        let result = match constructor_class {
            Some(class) => {
                let symbol = self.c.class_sym(of, class);
                self.class_result(symbol)
            }
            None => {
                let checked = self.checked_result(of, func, checked_mapper);
                self.annotated_position(of, hir[func].ret, written_mapper, checked)
            }
        };
        let has_class_type_parameters =
            constructor_class.is_some_and(|class| !hir[class].type_params.is_empty());
        SignatureShape {
            declaration: Some(FunctionRef {
                file: of,
                function: func,
            }),
            this_type,
            parameters,
            result,
            has_type_parameters: !hir[func].type_params.is_empty() || has_class_type_parameters,
        }
    }

    fn signature_parameters(
        &mut self,
        of: FileId,
        func: FnId,
        written_mapper: MapperId,
        checked_mapper: MapperId,
    ) -> &'c [SignatureParameter] {
        let hir = self.c.hir(of);
        let mut parameters: SmallVec<[SignatureParameter; 8]> = SmallVec::new();
        for id in hir[func].params.iter() {
            let parameter = &hir[id];
            let checked = self.ask(|queries| {
                let declared = queries.c.type_of_param(of, id);
                let declared = queries.resolved(declared)?;
                let declared = queries.infer_parameter_type(of, id, declared);
                queries.instantiate_signature_type(declared, checked_mapper)
            });
            parameters.push(SignatureParameter {
                types: self.annotated_position(of, parameter.ty, written_mapper, checked),
                is_optional: parameter.flags.contains(Flags::OPTIONAL)
                    || parameter.default.is_some(),
                is_rest: parameter.flags.contains(Flags::REST),
            });
        }
        self.list(&parameters)
    }

    fn signature_this_type(
        &mut self,
        of: FileId,
        func: FnId,
        written_mapper: MapperId,
        checked_mapper: MapperId,
    ) -> PositionTypes {
        let hir = self.c.hir(of);
        if let Some(this_param) = hir[func].this_param.some() {
            let checked = self.ask(|queries| {
                let declared = queries.c.type_of_this_parameter(of, func);
                queries.instantiate_signature_type(declared, checked_mapper)
            });
            return self.annotated_position(of, hir[this_param].ty, written_mapper, checked);
        }
        let Some((class, is_static)) = self.class_and_side_of_member_fn(of, func) else {
            let inferred = self.ask(|queries| Ok(queries.infer_this_type(of, func)));
            return PositionTypes::unwritten(inferred);
        };
        if is_static {
            return UNTYPED;
        }
        match hir[func].kind {
            FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
                let symbol = self.c.class_sym(of, class);
                PositionTypes::unwritten(self.class_instance_type(symbol))
            }
            _ => UNTYPED,
        }
    }
}
