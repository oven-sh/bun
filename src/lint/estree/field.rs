//! The names of the fields of ESTree nodes.

macro_rules! fields {
    ($($variant:ident $name:literal,)*) => {
        /// A field of an ESTree node.
        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        pub enum Field { $($variant),* }

        impl Field {
            /// Sorted by name.
            pub const ALL: &[Field] = &[$(Field::$variant),*];

            pub const fn name(self) -> &'static str {
                match self { $(Field::$variant => $name),* }
            }

            /// The field that is called `name`. `None` if no type of node has such a field.
            pub fn from_name(name: &[u8]) -> Option<Field> {
                let at = Field::ALL.binary_search_by(|it| it.name().as_bytes().cmp(name)).ok()?;
                Some(Field::ALL[at])
            }
        }
    };
}

fields! {
    Abstract "abstract",
    Accessibility "accessibility",
    Alternate "alternate",
    Argument "argument",
    Arguments "arguments",
    Assertions "assertions",
    Asserts "asserts",
    Async "async",
    Attributes "attributes",
    Await "await",
    Bigint "bigint",
    Block "block",
    Body "body",
    Callee "callee",
    Cases "cases",
    CheckType "checkType",
    Children "children",
    ClosingElement "closingElement",
    ClosingFragment "closingFragment",
    Computed "computed",
    Consequent "consequent",
    Const "const",
    Constraint "constraint",
    Declaration "declaration",
    Declarations "declarations",
    Declare "declare",
    Decorators "decorators",
    Default "default",
    Definite "definite",
    Delegate "delegate",
    Directive "directive",
    Discriminant "discriminant",
    ElementType "elementType",
    ElementTypes "elementTypes",
    Elements "elements",
    ExportKind "exportKind",
    Exported "exported",
    ExprName "exprName",
    Expression "expression",
    Expressions "expressions",
    Extends "extends",
    ExtendsType "extendsType",
    FalseType "falseType",
    Finalizer "finalizer",
    Generator "generator",
    Global "global",
    Handler "handler",
    Id "id",
    Implements "implements",
    ImportKind "importKind",
    Imported "imported",
    In "in",
    IndexType "indexType",
    Init "init",
    Initializer "initializer",
    Key "key",
    Kind "kind",
    Label "label",
    Left "left",
    Literal "literal",
    Local "local",
    Members "members",
    Meta "meta",
    Method "method",
    ModuleReference "moduleReference",
    Name "name",
    NameType "nameType",
    Namespace "namespace",
    Object "object",
    ObjectType "objectType",
    OpeningElement "openingElement",
    OpeningFragment "openingFragment",
    Operator "operator",
    Optional "optional",
    Options "options",
    Out "out",
    Override "override",
    Param "param",
    Parameter "parameter",
    ParameterName "parameterName",
    Parameters "parameters",
    Params "params",
    Phase "phase",
    Prefix "prefix",
    Properties "properties",
    Property "property",
    Qualifier "qualifier",
    Quasi "quasi",
    Quasis "quasis",
    Raw "raw",
    Readonly "readonly",
    Regex "regex",
    ReturnType "returnType",
    Right "right",
    SelfClosing "selfClosing",
    Shorthand "shorthand",
    Source "source",
    SourceType "sourceType",
    Specifiers "specifiers",
    Static "static",
    SuperClass "superClass",
    SuperTypeArguments "superTypeArguments",
    Tag "tag",
    Tail "tail",
    Test "test",
    TrueType "trueType",
    TypeAnnotation "typeAnnotation",
    TypeArguments "typeArguments",
    TypeName "typeName",
    TypeParameter "typeParameter",
    TypeParameters "typeParameters",
    Types "types",
    Update "update",
    Value "value",
}
