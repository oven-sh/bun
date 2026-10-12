// ------------- scopes -------------
//
// ESLint's `sourceCode.scopeManager`. `scopes.rs` sends the final answer as arrays of numbers, and `native.scopes`
// (src/jsc/bindings/LintScopes.cpp) builds all the objects of a file in one call. What is here are the classes of `eslint-scope` and
// of `@typescript-eslint/scope-manager` with their public methods.

// What is known about the scopes of the file. `null`: nobody has asked for them yet.
let scopeData = null;

function resetScopes() {
  scopeData = null;
}

// The indices of the variables for which rules have set `eslintUsed`.
function usedVariables() {
  return native.usedVariables() ?? [];
}

// `make()`, which is only called the first time. Many files are linted without a rule that asks for scopes.
const once = make => {
  let made;
  return () => (made ??= make());
};

// ------------- `eslint-scope` -------------

const eslintScopeLayout = once(() => {
  class Scope {
    resolve(ident) {
      assert(ident.type === "Identifier", "Target should be identifier.");
      return this.references.find(it => it.identifier === ident) ?? null;
    }
    isStatic() {
      return !this.dynamic;
    }
    isArgumentsMaterialized() {
      return true;
    }
    isThisMaterialized() {
      return true;
    }
    isUsedName(name) {
      return this.set.has(name) || this.through.some(it => it.identifier.name === name);
    }
  }
  class FunctionScope extends Scope {
    isArgumentsMaterialized() {
      if (this.block.type === "ArrowFunctionExpression") return false;
      if (!this.isStatic()) return true;
      const variable = this.set.get("arguments");
      return variable.tainted || variable.references.length !== 0;
    }
    isThisMaterialized() {
      return !this.isStatic() || this.thisFound;
    }
  }
  const types = [
    class GlobalScope extends Scope {},
    class ModuleScope extends Scope {},
    FunctionScope,
    class FunctionExpressionNameScope extends Scope {},
    class BlockScope extends Scope {},
    class SwitchScope extends Scope {},
    class CatchScope extends Scope {},
    class WithScope extends Scope {},
    class ForScope extends Scope {},
    class ClassScope extends Scope {},
    class ClassFieldInitializerScope extends Scope {},
    class ClassStaticBlockScope extends Scope {},
  ];

  class Variable {}
  Object.assign(Variable, {
    CatchClause: "CatchClause",
    Parameter: "Parameter",
    FunctionName: "FunctionName",
    ClassName: "ClassName",
    Variable: "Variable",
    ImportBinding: "ImportBinding",
    ImplicitGlobalVariable: "ImplicitGlobalVariable",
  });

  class Definition {}
  class ParameterDefinition extends Definition {}
  // By the `DeclarationKind`.
  const definitionClasses = new Array(11).fill(Definition);
  definitionClasses[1] = ParameterDefinition;

  class Reference {
    isStatic() {
      return !this.tainted && !!this.resolved && this.resolved.scope.isStatic();
    }
    isWrite() {
      return !!(this.flag & 2);
    }
    isRead() {
      return !!(this.flag & 1);
    }
    isReadOnly() {
      return this.flag === 1;
    }
    isWriteOnly() {
      return this.flag === 2;
    }
    isReadWrite() {
      return this.flag === 3;
    }
  }
  Object.assign(Reference, { READ: 1, WRITE: 2, RW: 3 });

  class ScopeManager {
    constructor(scopes, nodeToScope, declaredVariables) {
      const { ecmaVersion, sourceType, parserOptions } = fileSettings.languageOptions;
      this.scopes = scopes;
      this.globalScope = scopes[0];
      this.__nodeToScope = nodeToScope;
      this.__currentScope = null;
      this.__options = {
        optimistic: false,
        nodejsScope: parserOptions.ecmaFeatures?.globalReturn,
        impliedStrict: parserOptions.ecmaFeatures?.impliedStrict,
        sourceType,
        ecmaVersion,
        childVisitorKeys: native.visitorKeys(true),
        fallback: node =>
          Object.keys(node).filter(key => key !== "parent" && key !== "leadingComments" && key !== "trailingComments"),
        ignoreEval: true,
        jsx: parserOptions.ecmaFeatures?.jsx,
      };
      this.__declaredVariables = declaredVariables;
    }
    isGlobalReturn() {
      return this.__options.nodejsScope || this.__options.sourceType === "commonjs";
    }
    isModule() {
      return this.__options.sourceType === "module";
    }
    isImpliedStrict() {
      return !!this.__options.impliedStrict;
    }
    isStrictModeSupported() {
      return this.__options.ecmaVersion >= 5;
    }
    getDeclaredVariables(node) {
      return this.__declaredVariables.get(node) || [];
    }
    acquire(node, inner) {
      const scopes = this.__nodeToScope.get(node);
      if (!scopes || scopes.length === 0) return null;
      if (scopes.length === 1) return scopes[0];
      const isIt = scope => !(scope.type === "function" && scope.functionExpressionScope);
      return (inner ? scopes.findLast(isIt) : scopes.find(isIt)) ?? null;
    }
    acquireAll(node) {
      return this.__nodeToScope.get(node);
    }
    release(node, inner) {
      const scopes = this.__nodeToScope.get(node);
      if (!scopes || !scopes.length) return null;
      const scope = scopes[0].upper;
      return scope ? this.acquire(scope.block, inner) : null;
    }
    attach() {}
    detach() {}
  }

  return {
    ScopeManager,
    forNative: [types, Variable, null, definitionClasses, Reference, new Map()],
  };
});

// ------------- `@typescript-eslint/scope-manager` -------------

// The `set` of the global scope. The libraries of TypeScript can define thousands of variables, and most files ask for a few names.
// The others are made when something goes through all of them.
class GlobalSet extends Map {
  get(name) {
    const found = super.get(name);
    if (found !== undefined || scopeData.hasAllLibVariables || !Object.hasOwn(fileSettings.libs, name)) return found;
    const variable = libVariable(name);
    super.set(name, variable);
    return variable;
  }
  has(name) {
    return super.has(name) || (!scopeData.hasAllLibVariables && Object.hasOwn(fileSettings.libs, name));
  }
  get size() {
    addLibVariables();
    return super.size;
  }
  keys() {
    addLibVariables();
    return super.keys();
  }
  values() {
    addLibVariables();
    return super.values();
  }
  entries() {
    addLibVariables();
    return super.entries();
  }
  forEach(callback, thisArg) {
    addLibVariables();
    return super.forEach(callback, thisArg);
  }
  [Symbol.iterator]() {
    return this.entries();
  }
}

const typescriptLayout = once(() => {
  class ScopeBase {
    isVariableScope() {
      return this.variableScope === this;
    }
  }
  // By the `ScopeKind`.
  const types = [
    class GlobalScope extends ScopeBase {},
    class ModuleScope extends ScopeBase {},
    class FunctionScope extends ScopeBase {},
    class FunctionExpressionNameScope extends ScopeBase {},
    class BlockScope extends ScopeBase {},
    class SwitchScope extends ScopeBase {},
    class CatchScope extends ScopeBase {},
    class WithScope extends ScopeBase {},
    class ForScope extends ScopeBase {},
    class ClassScope extends ScopeBase {},
    class ClassFieldInitializerScope extends ScopeBase {},
    class ClassStaticBlockScope extends ScopeBase {},
    class TSModuleScope extends ScopeBase {},
    class TSEnumScope extends ScopeBase {},
    class TypeScope extends ScopeBase {},
    class ConditionalTypeScope extends ScopeBase {},
    class FunctionTypeScope extends ScopeBase {},
    class MappedTypeScope extends ScopeBase {},
  ];

  class VariableBase {}
  class Variable extends VariableBase {
    get isTypeVariable() {
      return this.defs.length === 0 || this.defs.some(def => def.isTypeDefinition);
    }
    get isValueVariable() {
      return this.defs.length === 0 || this.defs.some(def => def.isVariableDefinition);
    }
  }
  class ESLintScopeVariable extends VariableBase {}
  class ImplicitLibVariable extends ESLintScopeVariable {}

  class DefinitionBase {}
  // By the `DeclarationKind`.
  const definitionClasses = [
    class VariableDefinition extends DefinitionBase {},
    class ParameterDefinition extends DefinitionBase {},
    class FunctionNameDefinition extends DefinitionBase {},
    class ClassNameDefinition extends DefinitionBase {},
    class CatchClauseDefinition extends DefinitionBase {},
    class ImportBindingDefinition extends DefinitionBase {},
    class TSEnumNameDefinition extends DefinitionBase {},
    class TSEnumMemberDefinition extends DefinitionBase {},
    class TSModuleNameDefinition extends DefinitionBase {},
    class TypeDefinition extends DefinitionBase {},
    class ImplicitGlobalVariableDefinition extends DefinitionBase {},
  ];

  // The flags of a reference, which the real one has in private fields, are in the message.
  const flagsOf = reference => scopeData.referenceFlags[reference.$id - 1];
  class Reference {
    get isTypeReference() {
      return (flagsOf(this) & 4) !== 0;
    }
    get isValueReference() {
      return (flagsOf(this) & 16) !== 0;
    }
    isWrite() {
      return (flagsOf(this) & 2) !== 0;
    }
    isRead() {
      return (flagsOf(this) & 1) !== 0;
    }
    isReadOnly() {
      return (flagsOf(this) & 3) === 1;
    }
    isWriteOnly() {
      return (flagsOf(this) & 3) === 2;
    }
    isReadWrite() {
      return (flagsOf(this) & 3) === 3;
    }
  }

  class ScopeManager {
    constructor(scopes, nodeToScope, declaredVariables) {
      this.currentScope = null;
      this.declaredVariables = declaredVariables;
      this.globalScope = scopes[0];
      this.nodeToScope = nodeToScope;
      this.scopes = scopes;
    }
    isES6() {
      return true;
    }
    isGlobalReturn() {
      return fileSettings.languageOptions.parserOptions.ecmaFeatures?.globalReturn === true;
    }
    isImpliedStrict() {
      return fileSettings.languageOptions.parserOptions.ecmaFeatures?.impliedStrict === true;
    }
    isModule() {
      const { sourceType, parserOptions } = fileSettings.languageOptions;
      return (parserOptions.sourceType || sourceType) === "module";
    }
    isStrictModeSupported() {
      return true;
    }
    get variables() {
      return this.scopes.flatMap(it => it.variables);
    }
    getDeclaredVariables(node) {
      return this.declaredVariables.get(node) ?? [];
    }
    acquire(node, inner = false) {
      const scopes = this.nodeToScope.get(node);
      if (!scopes || scopes.length === 0) return null;
      if (scopes.length === 1) return scopes[0];
      const isIt = scope => !(scope.type === "function" && scope.functionExpressionScope);
      return (inner ? scopes.findLast(isIt) : scopes.find(isIt)) ?? null;
    }
  }

  return {
    ScopeManager,
    ImplicitLibVariable,
    forNative: [types, Variable, ImplicitLibVariable, definitionClasses, Reference, new GlobalSet()],
  };
});

// A variable that the libraries of TypeScript define, and that nothing in the file or in the configuration mentions.
function libVariable(name) {
  let variable = scopeData.libVariables.get(name);
  if (variable === undefined) {
    const flags = fileSettings.libs[name];
    variable = {
      __proto__: typescriptLayout().ImplicitLibVariable.prototype,
      $id: scopeData.variableCount + scopeData.libVariables.size + 1,
      defs: [],
      eslintUsed: false,
      identifiers: [],
      name,
      references: [],
      scope: scopeData.manager.globalScope,
      writeable: false,
      eslintExplicitGlobal: undefined,
      eslintImplicitGlobalSetting: "readonly",
      eslintExplicitGlobalComments: undefined,
      isTypeVariable: (flags & 1) !== 0,
      isValueVariable: (flags & 2) !== 0,
    };
    scopeData.libVariables.set(name, variable);
  }
  return variable;
}

// Puts the rest of them into `variables` and `set` of the global scope. typescript-eslint defines what is in the libraries first.
function addLibVariables() {
  if (scopeData.hasAllLibVariables) return;
  scopeData.hasAllLibVariables = true;
  const { globalScope } = scopeData.manager;
  const isOfLib = it => it instanceof typescriptLayout().ImplicitLibVariable;
  const mentioned = new Map(scopeData.mentionedGlobals.map(it => [it.name, it]));
  // A name that the file declares as well is only among the others.
  const ofLibs = Object.keys(fileSettings.libs).map(name => mentioned.get(name) ?? libVariable(name));
  const value = [...ofLibs.filter(isOfLib), ...scopeData.mentionedGlobals.filter(it => !isOfLib(it))];
  Map.prototype.clear.call(globalScope.set);
  for (const variable of value) Map.prototype.set.call(globalScope.set, variable.name, variable);
  Object.defineProperty(globalScope, "variables", { value, writable: true, enumerable: true, configurable: true });
}

function scopeManager() {
  if (scopeData !== null) return scopeData.manager;
  program();
  const layout = fileDialect === 1 ? eslintScopeLayout() : typescriptLayout();
  const names =
    globalNames.get(fileSettings) ?? globalNames.set(fileSettings, Object.keys(fileSettings.globals)).get(fileSettings);
  const made = native.scopes(layout.forNative, names, fileDialect === 0);
  const [listed, globalScope, variableCount, nodeToScope, declaredVariables, referenceFlags, explicitGlobals] = made;
  scopeData = {
    manager: new layout.ScopeManager(listed, nodeToScope, declaredVariables),
    variableCount,
    referenceFlags,
    libVariables: new Map(),
    mentionedGlobals: globalScope.variables,
    hasAllLibVariables: fileDialect === 1,
  };
  native.setScopeManager(scopeData.manager);
  // The comments are tokens, which are made here.
  const commentAt = start => sourceCode.getTokenByRangeStart(start, { includeComments: true });
  for (let i = 0; i < explicitGlobals.length; i += 2) {
    explicitGlobals[i].eslintExplicitGlobalComments = explicitGlobals[i + 1].map(commentAt);
  }
  if (fileDialect === 0) {
    Object.defineProperty(globalScope, "variables", {
      get() {
        addLibVariables();
        return this.variables;
      },
      set(value) {
        Object.defineProperty(this, "variables", { value, writable: true, enumerable: true, configurable: true });
      },
      enumerable: true,
      configurable: true,
    });
  }
  return scopeData.manager;
}

// By the settings of a file: the names of the configured globals.
const globalNames = new WeakMap();
