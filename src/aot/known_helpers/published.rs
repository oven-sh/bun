// The helpers of TypeScript, Babel, SWC, esbuild, rolldown and Bun that the compiler reads, in every form that was published.

use super::{PublishedFunction, Reference};

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Helper {
    ExportStar,
    CreateBinding,
    ClassPrivateFieldGet,
    ClassPrivateFieldSet,
    ClassPrivateFieldIn,
    MarkAsModule,
    Export,
    ExportSetter,
    ReturnValue,
    Require,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Shape {
    ExportStarBindsNamesTheTargetLacks,
    CreateBindingDefinesGetter,
    CreateBindingReusesDescriptor,
    CreateBindingCopiesValue,
    ClassPrivateFieldGetFromWeakMap,
    ClassPrivateFieldGetByKind,
    ClassPrivateFieldSetInWeakMap,
    ClassPrivateFieldSetByKind,
    ClassPrivateFieldInAsksStateOrComparesConstructor,
    MarkAsModuleDefinesFlag,
    ExportDefinesGetters,
    ExportMarksModuleAndDefinesGetters,
    ExportDefinesGettersAndSettersOfTheLastName,
    ExportDefinesGettersAndBoundSetters,
    ExportSetterStoresBoundReturnValue,
    ReturnValueReturnsArgument,
    RequireFactoryPrefersRequire,
}

impl Shape {
    pub const fn helper(self) -> Helper {
        match self {
            Shape::ExportStarBindsNamesTheTargetLacks => Helper::ExportStar,
            Shape::CreateBindingDefinesGetter => Helper::CreateBinding,
            Shape::CreateBindingReusesDescriptor => Helper::CreateBinding,
            Shape::CreateBindingCopiesValue => Helper::CreateBinding,
            Shape::ClassPrivateFieldGetFromWeakMap => Helper::ClassPrivateFieldGet,
            Shape::ClassPrivateFieldGetByKind => Helper::ClassPrivateFieldGet,
            Shape::ClassPrivateFieldSetInWeakMap => Helper::ClassPrivateFieldSet,
            Shape::ClassPrivateFieldSetByKind => Helper::ClassPrivateFieldSet,
            Shape::ClassPrivateFieldInAsksStateOrComparesConstructor => Helper::ClassPrivateFieldIn,
            Shape::MarkAsModuleDefinesFlag => Helper::MarkAsModule,
            Shape::ExportDefinesGetters => Helper::Export,
            Shape::ExportMarksModuleAndDefinesGetters => Helper::Export,
            Shape::ExportDefinesGettersAndSettersOfTheLastName => Helper::Export,
            Shape::ExportDefinesGettersAndBoundSetters => Helper::Export,
            Shape::ExportSetterStoresBoundReturnValue => Helper::ExportSetter,
            Shape::ReturnValueReturnsArgument => Helper::ReturnValue,
            Shape::RequireFactoryPrefersRequire => Helper::Require,
        }
    }
}

const DEFINE_PROPERTY: (&str, Reference) = (
    "__defProp",
    Reference::Global(&["Object", "defineProperty"]),
);

pub(super) static PUBLISHED_FUNCTIONS: &[PublishedFunction] = &[
    PublishedFunction {
        shape: Shape::ExportStarBindsNamesTheTargetLacks,
        text: "function(m, o) {\nfor (var p in m) if (p !== \"default\" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);\n}",
        references: &[("__createBinding", Reference::Helper(Helper::CreateBinding))],
        origin: "tslib 2.0.1 to 2.8.1; typescript 4.0 to 6.0",
    },
    PublishedFunction {
        shape: Shape::CreateBindingDefinesGetter,
        text: "function(o, m, k, k2) {\nif (k2 === undefined) k2 = k;\nObject.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });\n}",
        references: &[],
        origin: "tslib 1.12.0, 2.0.0 to 2.3.1; typescript 3.9 to 4.5",
    },
    PublishedFunction {
        shape: Shape::CreateBindingReusesDescriptor,
        text: "function(o, m, k, k2) {\nif (k2 === undefined) k2 = k;\nvar desc = Object.getOwnPropertyDescriptor(m, k);\nif (!desc || (\"get\" in desc ? !m.__esModule : desc.writable || desc.configurable)) {\ndesc = { enumerable: true, get: function() { return m[k]; } };\n}\nObject.defineProperty(o, k2, desc);\n}",
        references: &[],
        origin: "tslib 2.4.0 to 2.8.1; typescript 4.6 to 6.0",
    },
    PublishedFunction {
        shape: Shape::CreateBindingCopiesValue,
        text: "function(o, m, k, k2) {\nif (k2 === undefined) k2 = k;\no[k2] = m[k];\n}",
        references: &[],
        origin: "tslib 1.12.0 to 2.8.1; typescript 3.9 to 6.0",
    },
    PublishedFunction {
        shape: Shape::ClassPrivateFieldGetFromWeakMap,
        text: "function (receiver, privateMap) {\nif (!privateMap.has(receiver)) {\nthrow new TypeError(\"attempted to get private field on non-instance\");\n}\nreturn privateMap.get(receiver);\n}",
        references: &[],
        origin: "tslib 1.11.0 to 2.1.0; typescript 3.8 to 4.2",
    },
    PublishedFunction {
        shape: Shape::ClassPrivateFieldGetByKind,
        text: "function (receiver, state, kind, f) {\nif (kind === \"a\" && !f) throw new TypeError(\"Private accessor was defined without a getter\");\nif (typeof state === \"function\" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError(\"Cannot read private member from an object whose class did not declare it\");\nreturn kind === \"m\" ? f : kind === \"a\" ? f.call(receiver) : f ? f.value : state.get(receiver);\n}",
        references: &[],
        origin: "tslib 2.2.0 to 2.8.1; typescript 4.3 to 6.0",
    },
    PublishedFunction {
        shape: Shape::ClassPrivateFieldSetInWeakMap,
        text: "function (receiver, privateMap, value) {\nif (!privateMap.has(receiver)) {\nthrow new TypeError(\"attempted to set private field on non-instance\");\n}\nprivateMap.set(receiver, value);\nreturn value;\n}",
        references: &[],
        origin: "tslib 1.11.0 to 2.1.0; typescript 3.8 to 4.2",
    },
    PublishedFunction {
        shape: Shape::ClassPrivateFieldSetByKind,
        text: "function (receiver, state, value, kind, f) {\nif (kind === \"m\") throw new TypeError(\"Private method is not writable\");\nif (kind === \"a\" && !f) throw new TypeError(\"Private accessor was defined without a setter\");\nif (typeof state === \"function\" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError(\"Cannot write private member to an object whose class did not declare it\");\nreturn (kind === \"a\" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;\n}",
        references: &[],
        origin: "tslib 2.2.0 to 2.8.1; typescript 4.3 to 6.0",
    },
    PublishedFunction {
        shape: Shape::ClassPrivateFieldInAsksStateOrComparesConstructor,
        text: "function(state, receiver) {\nif (receiver === null || (typeof receiver !== \"object\" && typeof receiver !== \"function\")) throw new TypeError(\"Cannot use 'in' operator on non-object\");\nreturn typeof state === \"function\" ? receiver === state : state.has(receiver);\n}",
        references: &[],
        origin: "typescript 4.5 to 6.0; tslib 2.4.0 to 2.8.1",
    },
    PublishedFunction {
        shape: Shape::MarkAsModuleDefinesFlag,
        text: "(target) => __defProp(target, \"__esModule\", {value: true})",
        references: &[DEFINE_PROPERTY],
        origin: "esbuild 0.8 to 0.13",
    },
    PublishedFunction {
        shape: Shape::ExportDefinesGetters,
        text: "(target, all) => {\nfor (var name in all)\n__defProp(target, name, {get: all[name], enumerable: true});\n}",
        references: &[DEFINE_PROPERTY],
        origin: "esbuild 0.8 to 0.11, 0.14 to 0.28; rolldown 1.0.0-beta.18 to 1.0.0-beta.35, 1.2.12",
    },
    PublishedFunction {
        shape: Shape::ExportDefinesGetters,
        text: "function _export(target, all) {\nfor(var name in all)Object.defineProperty(target, name, {\nenumerable: true,\nget: all[name]\n});\n}",
        references: &[],
        origin: "swc 1.2.206 to 1.15; next 13.0 to 16.0",
    },
    PublishedFunction {
        shape: Shape::ExportMarksModuleAndDefinesGetters,
        text: "(target, all) => {\n__markAsModule(target);\nfor (var name in all)\n__defProp(target, name, { get: all[name], enumerable: true });\n}",
        references: &[
            ("__markAsModule", Reference::Helper(Helper::MarkAsModule)),
            DEFINE_PROPERTY,
        ],
        origin: "esbuild 0.12 to 0.13",
    },
    PublishedFunction {
        shape: Shape::ExportDefinesGettersAndSettersOfTheLastName,
        text: "(target, all) => {\nfor (var name in all)\n__defProp(target, name, {\nget: all[name],\nenumerable: true,\nconfigurable: true,\nset: (newValue) => (all[name] = () => newValue),\n});\n}",
        references: &[DEFINE_PROPERTY],
        origin: "bun 1.0.0 to 1.3.9",
    },
    PublishedFunction {
        shape: Shape::ExportDefinesGettersAndBoundSetters,
        text: "(target, all) => {\nfor (var name in all)\n__defProp(target, name, {\nget: all[name],\nenumerable: true,\nconfigurable: true,\nset: __exportSetter.bind(all, name),\n});\n}",
        references: &[
            DEFINE_PROPERTY,
            ("__exportSetter", Reference::Helper(Helper::ExportSetter)),
        ],
        origin: "bun 1.3.10 to 1.4.3",
    },
    PublishedFunction {
        shape: Shape::ExportSetterStoresBoundReturnValue,
        text: "function __exportSetter(name, newValue) {\nthis[name] = __returnValue.bind(null, newValue);\n}",
        references: &[("__returnValue", Reference::Helper(Helper::ReturnValue))],
        origin: "bun 1.3.10 to 1.4.3",
    },
    PublishedFunction {
        shape: Shape::ReturnValueReturnsArgument,
        text: "v => v",
        references: &[],
        origin: "bun 1.3.10 to 1.4.3",
    },
    PublishedFunction {
        shape: Shape::RequireFactoryPrefersRequire,
        text: "(x) => typeof require !== \"undefined\" ? require : typeof Proxy !== \"undefined\" ? new Proxy(x, {\nget: (a, b) => (typeof require !== \"undefined\" ? require : a)[b]\n}) : x",
        references: &[],
        origin: "esbuild 0.12 to 0.28; bun 1.1.10 to 1.4.2; rolldown 1.0.0-beta.18 to 1.2.12",
    },
    PublishedFunction {
        shape: Shape::RequireFactoryPrefersRequire,
        text: "(x) => typeof require < \"u\" ? require : typeof Proxy < \"u\" ? new Proxy(x, {\nget: (a, b) => (typeof require < \"u\" ? require : a)[b]\n}) : x",
        references: &[],
        origin: "esbuild 0.15 to 0.28; bun 1.2.23 to 1.4.2",
    },
];
