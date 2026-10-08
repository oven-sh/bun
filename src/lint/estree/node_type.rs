//! The types of ESTree nodes.

macro_rules! node_types {
    ($($name:ident)*) => {
        /// The `type` of a node: typescript-eslint's `AST_NODE_TYPES`.
        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        pub enum NodeType { $($name),* }

        impl NodeType {
            pub const ALL: &[NodeType] = &[$(NodeType::$name),*];

            pub const fn name(self) -> &'static str {
                match self { $(NodeType::$name => stringify!($name)),* }
            }
        }
    };
}

node_types! {
    AccessorProperty ArrayExpression ArrayPattern ArrowFunctionExpression AssignmentExpression
    AssignmentPattern AwaitExpression BinaryExpression BlockStatement BreakStatement
    CallExpression CatchClause ChainExpression ClassBody ClassDeclaration ClassExpression
    ConditionalExpression ContinueStatement DebuggerStatement Decorator DoWhileStatement
    EmptyStatement ExportAllDeclaration ExportDefaultDeclaration ExportNamedDeclaration
    ExportSpecifier ExpressionStatement ForInStatement ForOfStatement ForStatement
    FunctionDeclaration FunctionExpression Identifier IfStatement ImportAttribute ImportDeclaration
    ImportDefaultSpecifier ImportExpression ImportNamespaceSpecifier ImportSpecifier JSXAttribute
    JSXClosingElement JSXClosingFragment JSXElement JSXEmptyExpression JSXExpressionContainer
    JSXFragment JSXIdentifier JSXMemberExpression JSXNamespacedName JSXOpeningElement
    JSXOpeningFragment JSXSpreadAttribute JSXSpreadChild JSXText LabeledStatement Literal
    LogicalExpression MemberExpression MetaProperty MethodDefinition NewExpression ObjectExpression
    ObjectPattern PrivateIdentifier Program Property PropertyDefinition RestElement
    ReturnStatement SequenceExpression SpreadElement StaticBlock Super SwitchCase SwitchStatement
    TaggedTemplateExpression TemplateElement TemplateLiteral ThisExpression ThrowStatement
    TryStatement UnaryExpression UpdateExpression VariableDeclaration VariableDeclarator
    WhileStatement WithStatement YieldExpression TSAbstractAccessorProperty TSAbstractKeyword
    TSAbstractMethodDefinition TSAbstractPropertyDefinition TSAnyKeyword TSArrayType
    TSAsExpression TSAsyncKeyword TSBigIntKeyword TSBooleanKeyword TSCallSignatureDeclaration
    TSClassImplements TSConditionalType TSConstructorType TSConstructSignatureDeclaration
    TSDeclareFunction TSDeclareKeyword TSEmptyBodyFunctionExpression TSEnumBody TSEnumDeclaration
    TSEnumMember TSExportAssignment TSExportKeyword TSExternalModuleReference TSFunctionType
    TSImportEqualsDeclaration TSImportType TSIndexedAccessType TSIndexSignature TSInferType
    TSInstantiationExpression TSInterfaceBody TSInterfaceDeclaration TSInterfaceHeritage
    TSIntersectionType TSIntrinsicKeyword TSLiteralType TSMappedType TSMethodSignature
    TSModuleBlock TSModuleDeclaration TSNamedTupleMember TSNamespaceExportDeclaration
    TSNeverKeyword TSNonNullExpression TSNullKeyword TSNumberKeyword TSObjectKeyword
    TSOptionalType TSParameterProperty TSPrivateKeyword TSPropertySignature TSProtectedKeyword
    TSPublicKeyword TSQualifiedName TSReadonlyKeyword TSRestType TSSatisfiesExpression
    TSStaticKeyword TSStringKeyword TSSymbolKeyword TSTemplateLiteralType TSThisType TSTupleType
    TSTypeAliasDeclaration TSTypeAnnotation TSTypeAssertion TSTypeLiteral TSTypeOperator
    TSTypeParameter TSTypeParameterDeclaration TSTypeParameterInstantiation TSTypePredicate
    TSTypeQuery TSTypeReference TSUndefinedKeyword TSUnionType TSUnknownKeyword TSVoidKeyword
}
