//! `TypeOrValueSpecifier.ts`, `typeOrValueSpecifiers/*.ts`

use super::{MAX_DEPTH, Names};
use crate::ast::{Expr, ExprKind, Ident, Node, Pat};
use crate::options::Json;
use crate::types::tsutils::{is_intersection_type, is_union_type};
use crate::types::{NodeFlags, SourceFile, SymbolFlags, SyntaxKind, TsNode, TsSymbol, Type, Types};
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::join_spill;
use std::borrow::Cow;

/// `TypeOrValueSpecifier`: how the options of rules name types and values.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum TypeOrValueSpecifier {
    /// `"name"`: whatever has that name, wherever it is declared.
    Name(Vec<u8>),
    /// `FileSpecifier`, `{ from: "file", name, path }`: declared in that file, which is relative to
    /// the current directory, or without a path in any file below the current directory.
    File {
        name: Vec<Vec<u8>>,
        path: Option<Vec<u8>>,
    },
    /// `LibSpecifier`, `{ from: "lib", name }`: declared in TypeScript's default library.
    Lib { name: Vec<Vec<u8>> },
    /// `PackageSpecifier`, `{ from: "package", name, package }`: declared in that package.
    Package {
        name: Vec<Vec<u8>>,
        package: Vec<u8>,
    },
}

impl TypeOrValueSpecifier {
    /// An element of an option that has `typeOrValueSpecifiersSchema`. `None` for what the schema
    /// does not allow.
    pub fn parse(value: &Json) -> Option<TypeOrValueSpecifier> {
        if let Some(name) = value.as_str() {
            return Some(TypeOrValueSpecifier::Name(name.to_vec()));
        }
        let name = match value.get(b"name")? {
            Json::String(name) => vec![name.clone()],
            Json::Array(names) => names
                .iter()
                .map(|it| it.as_str().map(<[u8]>::to_vec))
                .collect::<Option<_>>()?,
            _ => return None,
        };
        Some(match value.get(b"from")?.as_str()? {
            b"file" => TypeOrValueSpecifier::File {
                name,
                path: value
                    .get(b"path")
                    .and_then(Json::as_str)
                    .map(<[u8]>::to_vec),
            },
            b"lib" => TypeOrValueSpecifier::Lib { name },
            b"package" => TypeOrValueSpecifier::Package {
                name,
                package: value.get(b"package")?.as_str()?.to_vec(),
            },
            _ => return None,
        })
    }

    /// `typeof specifier === 'string' ? [specifier] : getSpecifierNames(specifier.name)`
    pub fn names(&self) -> &[Vec<u8>] {
        match self {
            TypeOrValueSpecifier::Name(name) => std::slice::from_ref(name),
            TypeOrValueSpecifier::File { name, .. }
            | TypeOrValueSpecifier::Lib { name }
            | TypeOrValueSpecifier::Package { name, .. } => name,
        }
    }
}

/// An option that has `typeOrValueSpecifiersSchema`:
/// `parse_type_or_value_specifiers(options.object(0).array("allow"))`.
pub fn parse_type_or_value_specifiers(values: &[Json]) -> Vec<TypeOrValueSpecifier> {
    values
        .iter()
        .filter_map(TypeOrValueSpecifier::parse)
        .collect()
}

/// `specifierNameMatches(type, names)`
fn specifier_name_matches(ty: Type, names: &[Vec<u8>]) -> bool {
    let symbol = ty.alias_symbol().or_else(|| ty.get_symbol());
    symbol.is_some_and(|it| names.includes(it.escaped_name()))
        || ty
            .intrinsic_name()
            .is_some_and(|it| names.includes(it.as_bytes()))
}

/// `symbol?.getDeclarations() ?? []`
fn declarations_of<'a>(symbol: Option<TsSymbol<'a>>) -> impl Iterator<Item = TsNode<'a>> {
    symbol.map(|it| it.declarations()).into_iter().flatten()
}

/// `declarations.map(declaration => declaration.getSourceFile())`
fn declaration_files_of<'a>(symbol: Option<TsSymbol<'a>>) -> impl Iterator<Item = SourceFile<'a>> {
    declarations_of(symbol).map(|declaration| declaration.get_source_file())
}

/// `getCanonicalFileName(a) === getCanonicalFileName(b)`, for paths that are normalized.
fn is_same_file_name(program: Types, a: &[u8], b: &[u8]) -> bool {
    match program.compiler_options().use_case_sensitive_file_names {
        true => a == b,
        false => a.eq_ignore_ascii_case(b),
    }
}

/// `typeDeclaredInFile(relativePath, declarationFiles, program)`
fn type_declared_in_file<'a>(
    relative_path: Option<&[u8]>,
    mut declaration_files: impl Iterator<Item = SourceFile<'a>>,
    program: Types<'a>,
) -> bool {
    let current_directory = program.get_current_directory();
    let Some(relative_path) = relative_path else {
        let cwd = current_directory
            .strip_suffix(b"/")
            .unwrap_or(current_directory);
        return declaration_files.any(|declaration| {
            declaration
                .file_name()
                .get(..cwd.len())
                .is_some_and(|start| is_same_file_name(program, start, cwd))
        });
    };
    let mut spill = Vec::new();
    let absolute_path =
        join_spill::<Posix>(&mut spill, &[current_directory, relative_path]).to_vec();
    let absolute_path = absolute_path.strip_suffix(b"/").unwrap_or(&absolute_path);
    declaration_files
        .any(|declaration| is_same_file_name(program, declaration.file_name(), absolute_path))
}

/// `typeDeclaredInLib(declarationFiles, program)`. What has no declaration is intrinsic (`string`,
/// `number`), and counts as part of the library.
fn type_declared_in_lib<'a>(mut declaration_files: impl Iterator<Item = SourceFile<'a>>) -> bool {
    let Some(first) = declaration_files.next() else {
        return true;
    };
    first.is_default_library()
        || declaration_files.any(|declaration| declaration.is_default_library())
}

/// The `declare module "name" {}` that the node is in. `namespace a {}` and `global {}` are looked
/// through.
fn find_parent_module_declaration(node: TsNode<'_>) -> Option<TsNode<'_>> {
    for node in std::iter::once(node).chain(node.ancestors()) {
        match node.kind() {
            SyntaxKind::ModuleDeclaration
                if !node
                    .flags()
                    .intersects(NodeFlags::NAMESPACE | NodeFlags::GLOBAL_AUGMENTATION) =>
            {
                return node
                    .name()
                    .is_some_and(|name| name.kind() == SyntaxKind::StringLiteral)
                    .then_some(node);
            }
            SyntaxKind::SourceFile => return None,
            _ => {}
        }
    }
    None
}

fn type_declared_in_declare_module<'a>(
    package_name: &[u8],
    mut declarations: impl Iterator<Item = TsNode<'a>>,
) -> bool {
    declarations.any(|declaration| {
        let name = find_parent_module_declaration(declaration).and_then(|module| module.name());
        name.is_some_and(|name| name.text() == package_name)
    })
}

/// `checker.getAmbientModules().find(ambientModule => ambientModule.name === '"name"')`
fn find_ambient_module<'a>(program: Types<'a>, package_name: &[u8]) -> Option<TsSymbol<'a>> {
    program.get_ambient_module(package_name)
}

fn type_exported_from_declare_module<'a>(
    package_name: &[u8],
    symbol: Option<TsSymbol<'a>>,
    program: Types<'a>,
) -> bool {
    let Some(symbol) = symbol else {
        return false;
    };
    let Some(module_symbol) = find_ambient_module(program, package_name) else {
        return false;
    };
    module_symbol
        .get_exports_of_module()
        .iter()
        .any(|exported_symbol| {
            let resolved_symbol = match exported_symbol.has_flags(SymbolFlags::ALIAS) {
                true => exported_symbol.get_aliased_symbol(),
                false => exported_symbol,
            };
            resolved_symbol == symbol
        })
}

/// Whether `package_path` is `package_name` or something inside it, by whole components: `semver`
/// covers `semver` and `semver/classes/semver.d.ts`, not `semver-compare`.
fn path_is_in_package(package_path: &[u8], package_name: &[u8]) -> bool {
    match package_path.strip_prefix(package_name) {
        Some(rest) => rest.is_empty() || rest.starts_with(b"/"),
        None => false,
    }
}

/// `packageName.replace(/^@([^/]+)\//, '$1__')`: `@scope/name` is `scope__name` in `@types`.
fn types_package_name(package_name: &[u8]) -> Cow<'_, [u8]> {
    let scoped = package_name
        .strip_prefix(b"@")
        .and_then(|rest| strings::split_once_char(rest, b'/'));
    match scoped {
        Some((scope, name)) if !scope.is_empty() => Cow::Owned([scope, b"__", name].concat()),
        _ => Cow::Borrowed(package_name),
    }
}

fn type_declared_in_declaration_file<'a>(
    package_name: &[u8],
    mut declaration_files: impl Iterator<Item = SourceFile<'a>>,
) -> bool {
    let types_package_name = types_package_name(package_name);
    declaration_files.any(|declaration| {
        let Some(package_id_name) = declaration.package_name() else {
            return false;
        };
        let without_types = package_id_name
            .strip_prefix(b"@types/")
            .unwrap_or(package_id_name);
        (path_is_in_package(package_id_name, package_name)
            || path_is_in_package(without_types, &types_package_name))
            && declaration.is_from_external_library()
    })
}

/// `typeDeclaredInPackageDeclarationFile(packageName, symbol, ..)`
fn type_declared_in_package_declaration_file<'a>(
    package_name: &[u8],
    symbol: Option<TsSymbol<'a>>,
    program: Types<'a>,
) -> bool {
    type_declared_in_declare_module(package_name, declarations_of(symbol))
        || type_declared_in_declaration_file(package_name, declaration_files_of(symbol))
        || type_exported_from_declare_module(package_name, symbol, program)
}

/// `typeMatchesSpecifier(type, specifier, program)`: whether the type has the name, and is declared
/// where the specifier says. Every constituent of a union has to match, one of an intersection.
pub fn type_matches_specifier(ty: Type, specifier: &TypeOrValueSpecifier) -> bool {
    type_matches_specifier_at(ty, specifier, 0)
}

fn type_matches_specifier_at(ty: Type, specifier: &TypeOrValueSpecifier, depth: u32) -> bool {
    if depth > MAX_DEPTH {
        return false;
    }
    if is_union_type(ty) {
        return ty
            .types()
            .iter()
            .all(|t| type_matches_specifier_at(t, specifier, depth + 1));
    }
    whole_type_matches(ty, specifier)
        || is_intersection_type(ty)
            && ty
                .types()
                .iter()
                .any(|part| type_matches_specifier_at(part, specifier, depth + 1))
}

fn whole_type_matches(ty: Type, specifier: &TypeOrValueSpecifier) -> bool {
    if ty.is_error() || ty.is_unresolved() || !specifier_name_matches(ty, specifier.names()) {
        return false;
    }
    let symbol = || ty.get_symbol().or_else(|| ty.alias_symbol());
    let program = ty.file().type_checker();
    match specifier {
        TypeOrValueSpecifier::Name(_) => true,
        TypeOrValueSpecifier::File { path, .. } => {
            type_declared_in_file(path.as_deref(), declaration_files_of(symbol()), program)
        }
        TypeOrValueSpecifier::Lib { .. } => type_declared_in_lib(declaration_files_of(symbol())),
        TypeOrValueSpecifier::Package { package, .. } => {
            type_declared_in_package_declaration_file(package, symbol(), program)
        }
    }
}

/// `typeMatchesSomeSpecifier(type, specifiers, program)`
pub fn type_matches_some_specifier(ty: Type, specifiers: &[TypeOrValueSpecifier]) -> bool {
    specifiers
        .iter()
        .any(|specifier| type_matches_specifier(ty, specifier))
}

/// What [`value_matches_specifier`] takes as the `node`. It is asked for upstream's
/// `getStaticName`.
pub trait StaticallyNamed<'a>: Copy {
    /// The `name` of an `Identifier`, a `JSXIdentifier` or a `PrivateIdentifier`, which is without
    /// the `#`, or the value of a `Literal` that is a string.
    fn get_static_name(self) -> Option<&'a [u8]>;
}

impl<'a> StaticallyNamed<'a> for Expr<'a> {
    fn get_static_name(self) -> Option<&'a [u8]> {
        match self.kind() {
            ExprKind::Ident(name) => Some(name.bytes()),
            ExprKind::PrivateIdentifier(name) => name.bytes().strip_prefix(b"#"),
            ExprKind::String(value) if !self.is_jsx_text() => Some(value.bytes()),
            _ => None,
        }
    }
}

impl<'a> StaticallyNamed<'a> for Ident<'a> {
    fn get_static_name(self) -> Option<&'a [u8]> {
        let name = self.bytes();
        match self.is_string() {
            true => Some(name),
            false => Some(name.strip_prefix(b"#").unwrap_or(name)),
        }
    }
}

impl<'a> StaticallyNamed<'a> for Pat<'a> {
    fn get_static_name(self) -> Option<&'a [u8]> {
        self.as_ident().map(|name| name.bytes())
    }
}

impl<'a> StaticallyNamed<'a> for Node<'a> {
    fn get_static_name(self) -> Option<&'a [u8]> {
        match self {
            Node::Expr(it) => it.get_static_name(),
            Node::Pat(it) => it.get_static_name(),
            _ => None,
        }
    }
}

/// `valueMatchesSpecifier(node, specifier, program, type)`: whether `node`, an [`Expr`], a [`Pat`]
/// or an [`Ident`], is the name, and for a package also whether `ty`, its type, is declared there.
pub fn value_matches_specifier<'a>(
    node: impl StaticallyNamed<'a>,
    specifier: &TypeOrValueSpecifier,
    ty: Type<'a>,
) -> bool {
    let Some(static_name) = node.get_static_name().filter(|it| !it.is_empty()) else {
        return false;
    };
    if !specifier.names().includes(static_name) {
        return false;
    }
    match specifier {
        TypeOrValueSpecifier::Package { package, .. } => {
            let symbol = ty.get_symbol().or_else(|| ty.alias_symbol());
            type_declared_in_package_declaration_file(package, symbol, ty.file().type_checker())
        }
        _ => true,
    }
}

/// `valueMatchesSomeSpecifier(node, specifiers, program, type)`
pub fn value_matches_some_specifier<'a>(
    node: impl StaticallyNamed<'a>,
    specifiers: &[TypeOrValueSpecifier],
    ty: Type<'a>,
) -> bool {
    specifiers
        .iter()
        .any(|specifier| value_matches_specifier(node, specifier, ty))
}
