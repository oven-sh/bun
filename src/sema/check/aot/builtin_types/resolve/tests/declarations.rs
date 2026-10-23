use crate::atom::{Atom, Interner};
use crate::hir::{
    Alias, AliasId, Chain, Class, ClassId, ExprId, ExprKind, File, FileBuilder, FileKind, Flags,
    FnBody, FnId, FnKind, Func, IdList, Interface, InterfaceId, Keyword, Member, MemberKind,
    Module, ModuleId, ModuleName, ParamId, PatKind, PropKey, Span, StmtId, StmtKind, TextRange,
    TypeNodeId, TypeNodeKind, VarDecl, VarDeclId, VarKind,
};
use crate::json::Json;
use crate::resolve::{Host, ParseOptions, ScriptKind, ancestors, is_declaration_file_name};
use crate::session::Arena;
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use std::borrow::Cow;

const BLANK_TEXT: &[u8] = &[b' '; 4096];

#[derive(Copy, Clone)]
pub(super) enum Signature {
    Call,
    Method(&'static str),
}

#[derive(Copy, Clone)]
pub(super) enum Annotation {
    Any,
    Reference(&'static str),
}

#[derive(Copy, Clone)]
pub(super) enum Declaration {
    Interface {
        name: &'static str,
        extends: &'static [&'static str],
        members: &'static [Signature],
    },
    Class {
        name: &'static str,
        extends: Option<&'static str>,
        implements: &'static [&'static str],
    },
    Variable {
        name: &'static str,
        annotation: Annotation,
    },
    Function {
        name: &'static str,
        has_body: bool,
    },
    TypeAlias {
        name: &'static str,
        target: &'static str,
    },
    Namespace {
        name: &'static str,
        body: &'static [Declaration],
    },
    AmbientModule {
        specifier: &'static str,
        body: &'static [Declaration],
    },
    GlobalAugmentation(&'static [Declaration]),
    Declared(&'static [Declaration]),
    Exported(&'static [Declaration]),
}

#[derive(Copy, Clone)]
pub(super) struct SourceFile {
    pub(super) path: &'static str,
    pub(super) is_module: bool,
    pub(super) declarations: &'static [Declaration],
}

pub(super) struct DeclarationsHost<'a> {
    pub(super) files: &'a [SourceFile],
}

impl DeclarationsHost<'_> {
    fn find(&self, path: &[u8]) -> Option<&SourceFile> {
        self.files.iter().find(|file| file.path.as_bytes() == path)
    }
}

impl Host for DeclarationsHost<'_> {
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        self.find(path).map(|_| Cow::Borrowed(BLANK_TEXT))
    }

    fn is_file(&self, path: &[u8]) -> bool {
        self.find(path).is_some()
    }

    fn is_dir(&self, path: &[u8]) -> bool {
        let mut directories =
            (self.files.iter()).flat_map(|file| ancestors(dirname::<Posix>(file.path.as_bytes())));
        directories.any(|directory| directory == path)
    }

    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        path.to_vec()
    }

    fn list_dir(&self, _path: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn script_kind(&self, _path: &[u8]) -> Option<ScriptKind> {
        None
    }

    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &[]
    }

    fn scripts_of_page(&self, _page: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn parse<'s>(
        &self,
        arena: &'s Arena,
        path: &[u8],
        _text: &[u8],
        atoms: &Interner<'s>,
        _options: ParseOptions,
    ) -> File<'s> {
        let source = self.find(path).expect("only files of the host are parsed");
        build_tree(source, atoms, arena)
    }

    fn parse_package_json(&self, _arena: &Arena, _text: &[u8]) -> Option<Json> {
        None
    }

    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        (0..count).for_each(work);
    }
}

fn build_tree<'s>(source: &SourceFile, atoms: &Interner<'s>, arena: &'s Arena) -> File<'s> {
    let (kind, flags) = match is_declaration_file_name(source.path.as_bytes()) {
        true => (FileKind::Declaration, Flags::AMBIENT),
        false => (FileKind::Ts, Flags::empty()),
    };
    let mut tree = TreeBuilder {
        file: FileBuilder {
            kind,
            has_module_syntax: source.is_module,
            source_len: BLANK_TEXT.len() as u32,
            ..FileBuilder::default()
        },
        atoms,
        position: 0,
    };
    tree.file.body = tree.add_statements(source.declarations, flags);
    let (mut file, _) = tree.file.into_arena(arena, atoms.session());
    file.finish_nodes();
    file
}

struct TreeBuilder<'a, 's> {
    file: FileBuilder,
    atoms: &'a Interner<'s>,
    position: u32,
}

impl TreeBuilder<'_, '_> {
    fn next_position(&mut self) -> u32 {
        self.position += 1;
        assert!((self.position as usize) < BLANK_TEXT.len());
        self.position
    }

    fn add_name(&mut self, text: &[u8]) -> (Atom, u32) {
        (self.atoms.intern(text), self.next_position())
    }

    fn add_statements(&mut self, declarations: &[Declaration], flags: Flags) -> IdList<StmtId> {
        let mut statements = Vec::new();
        self.collect_statements(declarations, flags, &mut statements);
        self.file.list(&statements)
    }

    fn collect_statements(
        &mut self,
        declarations: &[Declaration],
        flags: Flags,
        statements: &mut Vec<StmtId>,
    ) {
        for declaration in declarations {
            let start = self.next_position();
            let kind = match *declaration {
                Declaration::Declared(declared) => {
                    self.collect_statements(declared, flags | Flags::AMBIENT, statements);
                    continue;
                }
                Declaration::Exported(exported) => {
                    self.collect_statements(exported, flags | Flags::EXPORT, statements);
                    continue;
                }
                Declaration::Interface {
                    name,
                    extends,
                    members,
                } => StmtKind::Interface(self.add_interface(name, extends, members, flags)),
                Declaration::Class {
                    name,
                    extends,
                    implements,
                } => StmtKind::Class(self.add_class(name, extends, implements, flags)),
                Declaration::Variable { name, annotation } => {
                    StmtKind::Var(self.add_variable(name, annotation, flags))
                }
                Declaration::Function { name, has_body } => {
                    StmtKind::Fn(self.add_function_declaration(name, has_body, flags))
                }
                Declaration::TypeAlias { name, target } => {
                    StmtKind::TypeAlias(self.add_type_alias(name, target, flags))
                }
                Declaration::Namespace { name, body } => {
                    let name = ModuleName::Ident(self.atoms.intern(name.as_bytes()));
                    StmtKind::Module(self.add_module(name, body, flags))
                }
                Declaration::AmbientModule { specifier, body } => {
                    let name = ModuleName::String(self.atoms.intern(specifier.as_bytes()));
                    StmtKind::Module(self.add_module(name, body, flags | Flags::AMBIENT))
                }
                Declaration::GlobalAugmentation(body) => {
                    let flags = flags | Flags::AMBIENT;
                    StmtKind::Module(self.add_module(ModuleName::Global, body, flags))
                }
            };
            let statement = self.file.stmt(kind, start);
            let end = self.next_position();
            self.file[statement].loc = TextRange { pos: start, end };
            statements.push(statement);
        }
    }

    fn add_type_reference(&mut self, name: &str) -> TypeNodeId {
        let names: Vec<(Atom, u32)> = strings::split(name.as_bytes(), b".")
            .map(|part| self.add_name(part))
            .collect();
        let start = names[0].1;
        let name = self.file.entity_name(names.into_iter());
        let args = IdList::EMPTY;
        let end = self.next_position();
        self.file.ty(TypeNodeKind::Ref { name, args }, start, end)
    }

    fn add_type_references(&mut self, names: &[&str]) -> IdList<TypeNodeId> {
        let references: Vec<TypeNodeId> = (names.iter())
            .map(|name| self.add_type_reference(name))
            .collect();
        self.file.list(&references)
    }

    fn add_entity_name_expression(&mut self, name: &str) -> ExprId {
        let mut parts = strings::split(name.as_bytes(), b".");
        let (root, start) = self.add_name(parts.next().unwrap_or_default());
        let end = self.next_position();
        let mut expression = self.file.expr(ExprKind::Ident(root), start, end);
        for part in parts {
            let member_name = self.add_name(part);
            let end = self.next_position();
            let member = self.file.dot((expression, Chain::No), member_name, end);
            expression = self.file.expr(member, start, end);
        }
        expression
    }

    fn add_function(&mut self, kind: FnKind, name: Atom, flags: Flags, body: FnBody) -> FnId {
        let start = self.next_position();
        let name_pos = self.next_position();
        let anchor = self.next_position();
        self.file.add_fn(Func {
            kind,
            flags,
            name,
            name_pos,
            type_params: Span::EMPTY,
            params: Span::EMPTY,
            this_param: ParamId::NONE,
            ret: TypeNodeId::NONE,
            body,
            anchor,
            start,
            text_start: start,
            is_strict: false,
            is_strict_by_syntax: false,
        })
    }

    fn create_member(&mut self, signature: Signature) -> Member {
        let start = self.next_position();
        let (kind, function_kind, key) = match signature {
            Signature::Call => (
                MemberKind::CallSignature,
                FnKind::CallSignature,
                PropKey::None,
            ),
            Signature::Method(name) => {
                let key = PropKey::Name(self.atoms.intern(name.as_bytes()));
                (MemberKind::Method, FnKind::Method, key)
            }
        };
        let name = key.name().unwrap_or(Atom::NONE);
        let func = self.add_function(function_kind, name, Flags::empty(), FnBody::None);
        let end = self.next_position();
        Member {
            kind,
            key,
            flags: Flags::empty(),
            ty: TypeNodeId::NONE,
            init: ExprId::NONE,
            func,
            name_pos: start,
            start,
            loc: TextRange { pos: start, end },
            modifiers: Span::EMPTY,
        }
    }

    fn add_interface(
        &mut self,
        name: &str,
        extends: &[&str],
        members: &[Signature],
        flags: Flags,
    ) -> InterfaceId {
        let (name, name_pos) = self.add_name(name.as_bytes());
        let extends = self.add_type_references(extends);
        let members: Vec<Member> = (members.iter())
            .map(|&signature| self.create_member(signature))
            .collect();
        let members = self.file.add_members(&members);
        self.file.add_interface(Interface {
            name,
            name_pos,
            flags,
            type_params: Span::EMPTY,
            extends,
            other_heritage: IdList::EMPTY,
            members,
            stmt: StmtId::NONE,
        })
    }

    fn add_class(
        &mut self,
        name: &str,
        extends: Option<&str>,
        implements: &[&str],
        flags: Flags,
    ) -> ClassId {
        let start = self.next_position();
        let (name, name_pos) = self.add_name(name.as_bytes());
        let extends = match extends {
            Some(base) => self.add_entity_name_expression(base),
            None => ExprId::NONE,
        };
        let implements = self.add_type_references(implements);
        self.file.add_class(Class {
            name,
            name_pos,
            flags,
            type_params: Span::EMPTY,
            extends,
            extends_args: IdList::EMPTY,
            other_extends: IdList::EMPTY,
            implements,
            other_implements: IdList::EMPTY,
            members: Span::EMPTY,
            start,
            text_start: start,
            modifiers: Span::EMPTY,
        })
    }

    fn add_variable(
        &mut self,
        name: &str,
        annotation: Annotation,
        flags: Flags,
    ) -> Span<VarDeclId> {
        let (name, start) = self.add_name(name.as_bytes());
        let name_end = self.next_position();
        let pat = self.file.pat(PatKind::Ident(name), start, name_end);
        let ty = match annotation {
            Annotation::Any => {
                let (type_start, type_end) = (self.next_position(), self.next_position());
                let keyword = TypeNodeKind::Keyword(Keyword::Any);
                self.file.ty(keyword, type_start, type_end)
            }
            Annotation::Reference(name) => self.add_type_reference(name),
        };
        let end = self.next_position();
        self.file.add_var_decls(&[VarDecl {
            pat,
            ty,
            init: ExprId::NONE,
            kind: VarKind::Var,
            flags,
            loc: TextRange { pos: start, end },
        }])
    }

    fn add_function_declaration(&mut self, name: &str, has_body: bool, flags: Flags) -> FnId {
        let name = self.atoms.intern(name.as_bytes());
        let body = match has_body {
            true => FnBody::Block(IdList::EMPTY),
            false => FnBody::None,
        };
        let function = self.add_function(FnKind::Decl, name, flags, body);
        if has_body {
            let open_brace = self.next_position();
            self.file.body_starts.push((function, open_brace));
        }
        function
    }

    fn add_type_alias(&mut self, name: &str, target: &str, flags: Flags) -> AliasId {
        let (name, name_pos) = self.add_name(name.as_bytes());
        let ty = self.add_type_reference(target);
        self.file.add_alias(Alias {
            name,
            name_pos,
            flags,
            type_params: Span::EMPTY,
            ty,
            stmt: StmtId::NONE,
        })
    }

    fn add_module(&mut self, name: ModuleName, body: &[Declaration], flags: Flags) -> ModuleId {
        let name_pos = self.next_position();
        let body = self.add_statements(body, flags & Flags::AMBIENT);
        self.file.add_module(Module {
            name,
            name_pos,
            flags,
            body,
            has_body: true,
            specifies_module: false,
            stmt: StmtId::NONE,
        })
    }
}
