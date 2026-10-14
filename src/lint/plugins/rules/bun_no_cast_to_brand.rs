use crate::bun::is_end_of_path;
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};

/// Disallow a cast to a branded type outside the module that declares it, and the import of what mints it where that is
/// not listed.
pub struct NoCastToBrand {
    brands: Box<[Brand]>,
}

/// An element of `branded`.
struct Brand {
    /// `module`: the end of the path of the file that declares the type, without the extension.
    module: Box<str>,
    /// `type`
    name: Box<str>,
    /// `mint`: the functions of the module that make a value of the type of any value.
    mint: Box<[Box<str>]>,
    /// `mintedIn`: the ends of the paths of the files that may import them.
    minted_in: Box<[Box<str>]>,
}

const CAST: Message = Message::new(
    "cast",
    "This cast makes a `{{type}}` of a value that nothing has checked. Only the module `{{module}}` makes one.",
);
const MINT: Message = Message::new(
    "mint",
    "`{{name}}` makes a `{{type}}` of any value, and this file is not listed as one that may import it.",
);

impl Brand {
    /// Whether `path`, with or without an extension, is that of the module.
    fn is_at(&self, path: &[u8]) -> bool {
        let stem = path.strip_suffix(paths::extname(path)).unwrap_or(path);
        let directory = stem.strip_suffix(b"/index").unwrap_or(stem);
        [path, stem, directory].iter().any(|it| is_end_of_path(it, self.module.as_bytes()))
    }

    /// Whether `specifier` is the module where it is written in `file`.
    fn is_imported_as(&self, specifier: Name, file: &File) -> bool {
        match specifier.bytes() {
            relative @ [b'.', ..] => self.is_at(&paths::resolve(paths::dirname(file.path()), relative)),
            other => self.is_at(other),
        }
    }

    fn may_be_minted_in(&self, file: &File) -> bool {
        self.is_at(file.path()) || self.minted_in.iter().any(|it| is_end_of_path(file.path(), it.as_bytes()))
    }

    fn mints(&self, name: Name) -> bool {
        self.mint.iter().any(|it| name.is(it))
    }

    fn report_mint<'a>(&self, at: Span, name: Name<'a>, cx: &Cx<'a, NoCastToBrand>) {
        cx.report(at, MINT).data("name", name).data("type", self.name.to_string());
    }
}

/// What the name of a type stands for.
enum Named<'a, 'r> {
    Brand(&'r Brand),
    Alias(TypeNode<'a>),
    /// `Array<T>`, `ReadonlyArray<T>`
    Array,
    Other,
}

impl NoCastToBrand {
    /// The brand that is called `name` in the module `specifier`.
    fn brand(&self, name: Name, specifier: Name, file: &File) -> Option<&Brand> {
        self.brands.iter().find(|it| name.is(&it.name) && it.is_imported_as(specifier, file))
    }

    fn named<'a>(&self, ty: TypeNode<'a>, name: EntityName<'a>, file: &File) -> Named<'a, '_> {
        let Some((first, last)) = name.first().zip(name.last()) else {
            return Named::Other;
        };
        let declaration = Node::Type(ty).scope().resolve_name(first.name()).and_then(|it| it.declarations().next());
        let brand = match (declaration, name.len()) {
            (None, 1) if first.name().is_any(&["Array", "ReadonlyArray"]) => return Named::Array,
            (Some(Declaration::TypeAlias(alias)), 1) => return Named::Alias(alias.ty()),
            (Some(Declaration::ImportSpec(it)), 1) => self.brand(it.imported().name(), it.import().spec(), file),
            (Some(Declaration::ImportNamespace(import)), 2) => self.brand(last.name(), import.spec(), file),
            _ => None,
        };
        brand.map_or(Named::Other, Named::Brand)
    }

    /// The brand that `ty` is, or that the elements of `ty` are.
    fn brand_in<'a>(&self, ty: TypeNode<'a>, file: &File) -> Option<&Brand> {
        let mut pending: SmallVec<[TypeNode<'a>; 8]> = smallvec![ty];
        // An alias can be its own.
        let mut seen = rustc_hash::FxHashSet::default();
        while let Some(ty) = pending.pop() {
            if !seen.insert(ty) {
                continue;
            }
            match ty.kind() {
                TypeKind::Array(element) | TypeKind::Readonly(element) => pending.push(element),
                TypeKind::Tuple(elements) => pending.extend(elements.iter().map(TupleElem::ty)),
                TypeKind::Union(members) => pending.extend(members.iter()),
                TypeKind::Ref { name, args } => match self.named(ty, name, file) {
                    Named::Brand(brand) => return Some(brand),
                    Named::Alias(aliased) => pending.push(aliased),
                    Named::Array => pending.extend(args.iter()),
                    Named::Other => {}
                },
                _ => {}
            }
        }
        None
    }

    /// The brands of the module `specifier` whose functions `file` may not import.
    fn guarded<'r, 'a>(&'r self, specifier: Name<'a>, file: &'a File<'a>) -> impl Iterator<Item = &'r Brand> {
        let of_module = self.brands.iter().filter(move |it| it.is_imported_as(specifier, file));
        of_module.filter(move |it| !it.may_be_minted_in(file))
    }
}

impl Rule for NoCastToBrand {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-cast-to-brand", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::As]).stmts(&[StmtTag::Import, StmtTag::ExportNamed]);
    no_state!();

    fn new(options: &Options) -> Self {
        let list = |names: Vec<&str>| names.into_iter().map(Box::from).collect();
        let brands = options.object(0).array("branded").iter().filter_map(|it| {
            let brand = Object::of(Some(it));
            Some(Brand {
                module: brand.str("module")?.into(),
                name: brand.str("type")?.into(),
                mint: list(brand.strings("mint")),
                minted_in: list(brand.strings("mintedIn")),
            })
        });
        NoCastToBrand { brands: brands.collect() }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if self.brands.iter().any(|it| file.mentions(&it.name) && !it.is_at(file.path())) {
            on = on.exprs(&[ExprTag::As]);
        }
        if self.brands.iter().any(|it| it.mint.iter().any(|name| file.mentions(name))) {
            on = on.stmts(&[StmtTag::Import, StmtTag::ExportNamed]);
        }
        on
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::As { ty, .. } = e.kind()
            && let Some(brand) = self.brand_in(ty, cx.file())
        {
            cx.report(ty, CAST).data("type", brand.name.to_string()).data("module", brand.module.to_string());
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        match statement.kind() {
            StmtKind::Import(import) if !import.is_type_only() => {
                for brand in self.guarded(import.spec(), file) {
                    for it in import.named().iter().filter(|it| !it.is_type_only()) {
                        if brand.mints(it.imported().name()) {
                            brand.report_mint(it.span(), it.imported().name(), cx);
                        }
                    }
                    // `module.mint`
                    let namespace = import.namespace().and_then(|it| file.top_level_scope().get_name(it.name()));
                    let uses = namespace.into_iter().flat_map(Symbol::references).filter_map(Reference::expr);
                    for member in uses.filter_map(|it| it.parent().as_expr()) {
                        if let ExprKind::Dot { name, .. } = member.kind()
                            && brand.mints(name.name())
                        {
                            brand.report_mint(member.span(), name.name(), cx);
                        }
                    }
                }
            }
            StmtKind::ExportNamed(export) if !export.is_type_only() => {
                for brand in export.spec().into_iter().flat_map(|it| self.guarded(it, file)) {
                    for it in export.items().iter().filter(|it| !it.is_type_only()) {
                        if brand.mints(it.local().name()) {
                            brand.report_mint(it.span(), it.local().name(), cx);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}
