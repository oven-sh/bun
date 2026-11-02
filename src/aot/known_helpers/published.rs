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
    CommonJs,
    Esm,
    Require,
    CopyProperties,
    ToCommonJs,
    ToEsModule,
    ReExport,
    SetModuleDefault,
    ImportStar,
    ImportDefault,
    DefineProperties,
    CreateClass,
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
    CommonJsRunsCallbackOnce,
    CommonJsRunsCallbackOnceThenDropsIt,
    CommonJsRunsFirstKeyOnce,
    CommonJsRunsFirstOwnNameOnce,
    CommonJsRunsFirstOwnNameOnceThenDropsIt,
    CommonJsRunsFirstOwnNameAgainAfterThrow,
    EsmRunsFunctionOnce,
    EsmRunsFunctionOnceRethrows,
    EsmRunsFirstKeyOnce,
    EsmRunsFirstOwnNameOnce,
    EsmRunsFirstOwnNameOnceRethrows,
    RequireFactoryPrefersRequire,
    CopyPropertiesDefinesGettersForOwnNamesTheTargetLacks,
    ToCommonJsCopiesOntoNewMarkedObject,
    ToEsModuleShowsUnmarkedValueAsDefault,
    ToEsModuleShowsValueWithoutDefaultAsDefault,
    ReExportCopiesAllButDefault,
    SetModuleDefaultDefinesValue,
    SetModuleDefaultStoresValue,
    ImportStarAnswersMarkedValueOrBindsItsEnumerableNames,
    ImportStarAnswersMarkedValueOrBindsItsOwnNames,
    ImportDefaultAnswersMarkedValueOrWrapsIt,
    DefinePropertiesOfDescriptors,
    CreateClassDefinesBothSides,
    CreateClassDefinesBothSidesAndLocksPrototype,
}

impl Shape {
    pub const fn helper(self) -> Helper {
        match self {
            Shape::ExportStarBindsNamesTheTargetLacks => Helper::ExportStar,
            Shape::DefinePropertiesOfDescriptors => Helper::DefineProperties,
            Shape::CreateClassDefinesBothSides => Helper::CreateClass,
            Shape::CreateClassDefinesBothSidesAndLocksPrototype => Helper::CreateClass,
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
            Shape::CommonJsRunsCallbackOnce => Helper::CommonJs,
            Shape::CommonJsRunsCallbackOnceThenDropsIt => Helper::CommonJs,
            Shape::CommonJsRunsFirstKeyOnce => Helper::CommonJs,
            Shape::CommonJsRunsFirstOwnNameOnce => Helper::CommonJs,
            Shape::CommonJsRunsFirstOwnNameOnceThenDropsIt => Helper::CommonJs,
            Shape::CommonJsRunsFirstOwnNameAgainAfterThrow => Helper::CommonJs,
            Shape::EsmRunsFunctionOnce => Helper::Esm,
            Shape::EsmRunsFunctionOnceRethrows => Helper::Esm,
            Shape::EsmRunsFirstKeyOnce => Helper::Esm,
            Shape::EsmRunsFirstOwnNameOnce => Helper::Esm,
            Shape::EsmRunsFirstOwnNameOnceRethrows => Helper::Esm,
            Shape::RequireFactoryPrefersRequire => Helper::Require,
            Shape::CopyPropertiesDefinesGettersForOwnNamesTheTargetLacks => Helper::CopyProperties,
            Shape::ToCommonJsCopiesOntoNewMarkedObject => Helper::ToCommonJs,
            Shape::ToEsModuleShowsUnmarkedValueAsDefault => Helper::ToEsModule,
            Shape::ToEsModuleShowsValueWithoutDefaultAsDefault => Helper::ToEsModule,
            Shape::ReExportCopiesAllButDefault => Helper::ReExport,
            Shape::SetModuleDefaultDefinesValue => Helper::SetModuleDefault,
            Shape::SetModuleDefaultStoresValue => Helper::SetModuleDefault,
            Shape::ImportStarAnswersMarkedValueOrBindsItsEnumerableNames => Helper::ImportStar,
            Shape::ImportStarAnswersMarkedValueOrBindsItsOwnNames => Helper::ImportStar,
            Shape::ImportDefaultAnswersMarkedValueOrWrapsIt => Helper::ImportDefault,
        }
    }
}

const GET_OWN_PROPERTY_NAMES: (&str, Reference) = (
    "__getOwnPropNames",
    Reference::Global(&["Object", "getOwnPropertyNames"]),
);

const DEFINE_PROPERTY: (&str, Reference) = (
    "__defProp",
    Reference::Global(&["Object", "defineProperty"]),
);

const GET_OWN_PROPERTY_DESCRIPTOR: (&str, Reference) = (
    "__getOwnPropDesc",
    Reference::Global(&["Object", "getOwnPropertyDescriptor"]),
);

const HAS_OWN_PROPERTY: (&str, Reference) = (
    "__hasOwnProp",
    Reference::Global(&["Object", "prototype", "hasOwnProperty"]),
);

const CREATE: (&str, Reference) = ("__create", Reference::Global(&["Object", "create"]));

const GET_PROTOTYPE_OF: (&str, Reference) = (
    "__getProtoOf",
    Reference::Global(&["Object", "getPrototypeOf"]),
);

const COPY_PROPERTIES: (&str, Reference) =
    ("__copyProps", Reference::Helper(Helper::CopyProperties));

pub(super) static PUBLISHED_FUNCTIONS: &[PublishedFunction] = &[
    PublishedFunction {
        shape: Shape::DefinePropertiesOfDescriptors,
        text: "function(target, props) {\nfor (var i = 0; i < props.length; i++) {\nvar descriptor = props[i];\ndescriptor.enumerable = descriptor.enumerable || false;\ndescriptor.configurable = true;\nif (\"value\" in descriptor) descriptor.writable = true;\nObject.defineProperty(target, descriptor.key, descriptor);\n}\n}",
        references: &[],
        origin: "babel 7 before 7.20, swc",
    },
    PublishedFunction {
        shape: Shape::CreateClassDefinesBothSides,
        text: "function(Constructor, protoProps, staticProps) {\nif (protoProps) _defineProperties(Constructor.prototype, protoProps);\nif (staticProps) _defineProperties(Constructor, staticProps);\nreturn Constructor;\n}",
        references: &[(
            "_defineProperties",
            Reference::Helper(Helper::DefineProperties),
        )],
        origin: "babel 7 before 7.18, swc",
    },
    PublishedFunction {
        shape: Shape::CreateClassDefinesBothSidesAndLocksPrototype,
        text: "function(Constructor, protoProps, staticProps) {\nif (protoProps) _defineProperties(Constructor.prototype, protoProps);\nif (staticProps) _defineProperties(Constructor, staticProps);\nObject.defineProperty(Constructor, \"prototype\", { writable: false });\nreturn Constructor;\n}",
        references: &[(
            "_defineProperties",
            Reference::Helper(Helper::DefineProperties),
        )],
        origin: "babel 7.18 and after",
    },
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
        shape: Shape::CommonJsRunsCallbackOnce,
        text: "(callback, module2) => () => {\nif (!module2) {\nmodule2 = {exports: {}};\ncallback(module2.exports, module2);\n}\nreturn module2.exports;\n}",
        references: &[],
        origin: "esbuild 0.8 to 0.9",
    },
    PublishedFunction {
        shape: Shape::CommonJsRunsCallbackOnce,
        text: "(callback, module2) => () => (module2 || (module2 = {exports: {}}, callback(module2.exports, module2)), module2.exports)",
        references: &[],
        origin: "esbuild 0.8 to 0.9",
    },
    PublishedFunction {
        shape: Shape::CommonJsRunsCallbackOnce,
        text: "(cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports)",
        references: &[],
        origin: "bun 1.0.0 to 1.4.3; rolldown 1.0.0-beta.18 to 1.0.0-rc.15",
    },
    PublishedFunction {
        shape: Shape::CommonJsRunsCallbackOnceThenDropsIt,
        text: "(cb, mod) => () => (\nmod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports\n)",
        references: &[],
        origin: "rolldown 1.0.0-rc.17 to 1.2.12",
    },
    PublishedFunction {
        shape: Shape::CommonJsRunsFirstKeyOnce,
        text: "(cb, mod) => function __require() {\nreturn mod || (0, cb[Object.keys(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;\n}",
        references: &[],
        origin: "esbuild 0.12 to 0.13",
    },
    PublishedFunction {
        shape: Shape::CommonJsRunsFirstKeyOnce,
        text: "(cb, mod) => function() {\nreturn mod || (0, cb[Object.keys(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;\n}",
        references: &[],
        origin: "esbuild 0.12 to 0.13",
    },
    PublishedFunction {
        shape: Shape::CommonJsRunsFirstOwnNameOnce,
        text: "(cb, mod) => function __require() {\nreturn mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;\n}",
        references: &[GET_OWN_PROPERTY_NAMES],
        origin: "esbuild 0.14 to 0.27",
    },
    PublishedFunction {
        shape: Shape::CommonJsRunsFirstOwnNameOnce,
        text: "(cb, mod) => function() {\nreturn mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;\n}",
        references: &[GET_OWN_PROPERTY_NAMES],
        origin: "esbuild 0.14 to 0.27; rolldown 1.0.0-beta.18 to 1.0.0-rc.15",
    },
    PublishedFunction {
        shape: Shape::CommonJsRunsFirstOwnNameOnceThenDropsIt,
        text: "(cb, mod) =>\nfunction () {\nreturn (\nmod || ((0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), cb = null), mod.exports\n);\n}",
        references: &[GET_OWN_PROPERTY_NAMES],
        origin: "rolldown 1.0.0-rc.17 to 1.2.12",
    },
    PublishedFunction {
        shape: Shape::CommonJsRunsFirstOwnNameAgainAfterThrow,
        text: "(cb, mod) => function __require() {\ntry {\nreturn mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;\n} catch (e) {\nthrow mod = 0, e;\n}\n}",
        references: &[GET_OWN_PROPERTY_NAMES],
        origin: "esbuild 0.28",
    },
    PublishedFunction {
        shape: Shape::CommonJsRunsFirstOwnNameAgainAfterThrow,
        text: "(cb, mod) => function() {\ntry {\nreturn mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;\n} catch (e) {\nthrow mod = 0, e;\n}\n}",
        references: &[GET_OWN_PROPERTY_NAMES],
        origin: "esbuild 0.28",
    },
    PublishedFunction {
        shape: Shape::EsmRunsFunctionOnce,
        text: "(fn, res) => () => (fn && (res = fn((fn = 0))), res)",
        references: &[],
        origin: "bun 1.0.0 to 1.4.0; rolldown 1.0.0-beta.18 to 1.1.0",
    },
    PublishedFunction {
        shape: Shape::EsmRunsFunctionOnceRethrows,
        text: "(fn, res, err) => () => {\nif (fn)\ntry {\nres = fn((fn = 0));\n} catch (e) {\nerr = [e];\n}\nif (err) throw err[0];\nreturn res;\n}",
        references: &[],
        origin: "bun 1.4.1 to 1.4.3",
    },
    PublishedFunction {
        shape: Shape::EsmRunsFunctionOnceRethrows,
        text: "(fn, res, err) => () => {\nif (err) throw err[0];\ntry {\nreturn (fn && (res = fn((fn = 0))), res);\n} catch (e) {\nthrow ((err = [e]), e);\n}\n}",
        references: &[],
        origin: "rolldown 1.1.3 to 1.2.12",
    },
    PublishedFunction {
        shape: Shape::EsmRunsFirstKeyOnce,
        text: "(fn, res) => function __init() {\nreturn fn && (res = (0, fn[Object.keys(fn)[0]])(fn = 0)), res;\n}",
        references: &[],
        origin: "esbuild 0.12 to 0.13",
    },
    PublishedFunction {
        shape: Shape::EsmRunsFirstKeyOnce,
        text: "(fn, res) => function() {\nreturn fn && (res = (0, fn[Object.keys(fn)[0]])(fn = 0)), res;\n}",
        references: &[],
        origin: "esbuild 0.12 to 0.13",
    },
    PublishedFunction {
        shape: Shape::EsmRunsFirstOwnNameOnce,
        text: "(fn, res) => function __init() {\nreturn fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;\n}",
        references: &[GET_OWN_PROPERTY_NAMES],
        origin: "esbuild 0.14 to 0.27",
    },
    PublishedFunction {
        shape: Shape::EsmRunsFirstOwnNameOnce,
        text: "(fn, res) => function() {\nreturn fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;\n}",
        references: &[GET_OWN_PROPERTY_NAMES],
        origin: "esbuild 0.14 to 0.27; rolldown 1.0.0-beta.18 to 1.1.0",
    },
    PublishedFunction {
        shape: Shape::EsmRunsFirstOwnNameOnceRethrows,
        text: "(fn, res, err) => function __init() {\nif (err) throw err[0];\ntry {\nreturn fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;\n} catch (e) {\nthrow err = [e], e;\n}\n}",
        references: &[GET_OWN_PROPERTY_NAMES],
        origin: "esbuild 0.28",
    },
    PublishedFunction {
        shape: Shape::EsmRunsFirstOwnNameOnceRethrows,
        text: "(fn, res, err) => function() {\nif (err) throw err[0];\ntry {\nreturn fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;\n} catch (e) {\nthrow err = [e], e;\n}\n}",
        references: &[GET_OWN_PROPERTY_NAMES],
        origin: "esbuild 0.28; rolldown 1.1.3 to 1.2.12",
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
    PublishedFunction {
        shape: Shape::CopyPropertiesDefinesGettersForOwnNamesTheTargetLacks,
        text: "(to, from, except, desc) => {\nif (from && typeof from === \"object\" || typeof from === \"function\") {\nfor (let key of __getOwnPropNames(from))\nif (!__hasOwnProp.call(to, key) && key !== except)\n__defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });\n}\nreturn to;\n}",
        references: &[
            GET_OWN_PROPERTY_NAMES,
            HAS_OWN_PROPERTY,
            DEFINE_PROPERTY,
            GET_OWN_PROPERTY_DESCRIPTOR,
        ],
        origin: "esbuild 0.21",
    },
    PublishedFunction {
        shape: Shape::CopyPropertiesDefinesGettersForOwnNamesTheTargetLacks,
        text: "(to, from, except, desc) => {\nif (from && typeof from == \"object\" || typeof from == \"function\")\nfor (let key of __getOwnPropNames(from))\n!__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });\nreturn to;\n}",
        references: &[
            GET_OWN_PROPERTY_NAMES,
            HAS_OWN_PROPERTY,
            DEFINE_PROPERTY,
            GET_OWN_PROPERTY_DESCRIPTOR,
        ],
        origin: "esbuild 0.21 where it shortens syntax",
    },
    PublishedFunction {
        shape: Shape::CopyPropertiesDefinesGettersForOwnNamesTheTargetLacks,
        text: "(to, from, except, desc) => {\nif (from && typeof from === \"object\" || typeof from === \"function\") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {\nkey = keys[i];\nif (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {\nget: ((k) => from[k]).bind(null, key),\nenumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable\n});\n}\nreturn to;\n}",
        references: &[
            GET_OWN_PROPERTY_NAMES,
            HAS_OWN_PROPERTY,
            DEFINE_PROPERTY,
            GET_OWN_PROPERTY_DESCRIPTOR,
        ],
        origin: "rolldown 1.2",
    },
    PublishedFunction {
        shape: Shape::ToCommonJsCopiesOntoNewMarkedObject,
        text: "(mod) => __copyProps(__defProp({}, \"__esModule\", { value: true }), mod)",
        references: &[COPY_PROPERTIES, DEFINE_PROPERTY],
        origin: "esbuild 0.21",
    },
    PublishedFunction {
        shape: Shape::ToEsModuleShowsUnmarkedValueAsDefault,
        text: "(mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(\nisNodeMode || !mod || !mod.__esModule ? __defProp(target, \"default\", { value: mod, enumerable: true }) : target,\nmod\n))",
        references: &[CREATE, GET_PROTOTYPE_OF, COPY_PROPERTIES, DEFINE_PROPERTY],
        origin: "esbuild 0.21; rolldown 1.0",
    },
    PublishedFunction {
        shape: Shape::ToEsModuleShowsValueWithoutDefaultAsDefault,
        text: "(mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, \"default\") ? __defProp(target, \"default\", {\nvalue: mod,\nenumerable: true\n}) : target, mod))",
        references: &[
            CREATE,
            GET_PROTOTYPE_OF,
            COPY_PROPERTIES,
            HAS_OWN_PROPERTY,
            DEFINE_PROPERTY,
        ],
        origin: "rolldown 1.2",
    },
    PublishedFunction {
        shape: Shape::ReExportCopiesAllButDefault,
        text: "(target, mod, secondTarget) => (__copyProps(target, mod, \"default\"), secondTarget && __copyProps(secondTarget, mod, \"default\"))",
        references: &[COPY_PROPERTIES],
        origin: "esbuild 0.21",
    },
    PublishedFunction {
        shape: Shape::SetModuleDefaultDefinesValue,
        text: "function(o, v) {\nObject.defineProperty(o, \"default\", { enumerable: true, value: v });\n}",
        references: &[],
        origin: "typescript 3.9 to 6.0",
    },
    PublishedFunction {
        shape: Shape::SetModuleDefaultStoresValue,
        text: "function(o, v) {\no[\"default\"] = v;\n}",
        references: &[],
        origin: "typescript 3.9 to 6.0",
    },
    PublishedFunction {
        shape: Shape::ImportStarAnswersMarkedValueOrBindsItsEnumerableNames,
        text: "function (mod) {\nif (mod && mod.__esModule) return mod;\nvar result = {};\nif (mod != null) for (var k in mod) if (k !== \"default\" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);\n__setModuleDefault(result, mod);\nreturn result;\n}",
        references: &[
            ("__createBinding", Reference::Helper(Helper::CreateBinding)),
            (
                "__setModuleDefault",
                Reference::Helper(Helper::SetModuleDefault),
            ),
        ],
        origin: "typescript 4.0 to 5.6",
    },
    PublishedFunction {
        shape: Shape::ImportStarAnswersMarkedValueOrBindsItsOwnNames,
        text: "function () {\nvar ownKeys = function(o) {\nownKeys = Object.getOwnPropertyNames || function (o) {\nvar ar = [];\nfor (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;\nreturn ar;\n};\nreturn ownKeys(o);\n};\nreturn function (mod) {\nif (mod && mod.__esModule) return mod;\nvar result = {};\nif (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== \"default\") __createBinding(result, mod, k[i]);\n__setModuleDefault(result, mod);\nreturn result;\n};\n}",
        references: &[
            ("__createBinding", Reference::Helper(Helper::CreateBinding)),
            (
                "__setModuleDefault",
                Reference::Helper(Helper::SetModuleDefault),
            ),
        ],
        origin: "typescript 5.7 to 6.0",
    },
    PublishedFunction {
        shape: Shape::ImportDefaultAnswersMarkedValueOrWrapsIt,
        text: "function (mod) {\nreturn (mod && mod.__esModule) ? mod : { \"default\": mod };\n}",
        references: &[],
        origin: "typescript 2.7 to 6.0",
    },
];
