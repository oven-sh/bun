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
        childVisitorKeys: native.visitorKeys(1),
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
// So it is empty until something goes through it or writes to it, and then it has all of them: src/jsc/bindings/LintScopes.cpp.
class GlobalSet extends Map {
  get(name) {
    const found = super.get(name);
    return found !== undefined ? found : native.globalVariable(name, this);
  }
  has(name) {
    return super.has(name) || native.globalVariable(name, this) !== undefined;
  }
  set(name, value) {
    native.addLibVariables(this);
    return super.set(name, value);
  }
  delete(name) {
    native.addLibVariables(this);
    return super.delete(name);
  }
  clear() {
    native.addLibVariables(this);
    super.clear();
  }
  get size() {
    native.addLibVariables(this);
    return super.size;
  }
  keys() {
    native.addLibVariables(this);
    return super.keys();
  }
  values() {
    native.addLibVariables(this);
    return super.values();
  }
  entries() {
    native.addLibVariables(this);
    return super.entries();
  }
  forEach(callback, thisArg) {
    native.addLibVariables(this);
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
    // typescript-eslint sorts them by `$id`, which is the order in which it makes them: what the libraries define, what the file declares
    // as its traversal comes to it, what ESLint adds. This is not that algorithm. It takes a variable to be made where its name is, and
    // not before the one that is before it in its scope. With the objects of typescript-eslint 8.71.1 that gives the order of the real
    // getter in 37,525 of 37,603 files. In the others the traversal doesn't go by position: type parameters come after parameters.
    get variables() {
      const isOfLib = it => it instanceof ImplicitLibVariable;
      const others = [];
      this.scopes.forEach((scope, scopeIndex) => {
        const { block } = scope;
        const unnamed =
          scopeIndex === 0 ? Infinity : scope.type === "function" && block.id ? block.id.range[1] : block.range[0];
        let time = -1;
        for (const variable of scope.variables) {
          if (isOfLib(variable)) continue;
          const name = variable.identifiers[0] ?? variable.defs[0]?.name;
          time = Math.max(time, name ? name.range[0] : unnamed);
          others.push({ variable, time, scopeIndex });
        }
      });
      others.sort((a, b) => a.time - b.time || a.scopeIndex - b.scopeIndex);
      return [...this.globalScope.variables.filter(isOfLib), ...others.map(it => it.variable)];
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
    forNative: [types, Variable, ImplicitLibVariable, definitionClasses, Reference, new GlobalSet()],
    // oxlint has no libraries, so nothing is made on demand.
    forOxlint: [types, Variable, ImplicitLibVariable, definitionClasses, Reference, new Map()],
  };
});

// oxlint's `sourceCode.scopeManager`: one object for all files, which analyzes the file being linted when something is asked of it.
const oxlintScopeManager = Object.freeze({
  get scopes() {
    return scopeManager().scopes;
  },
  get globalScope() {
    return scopeManager().globalScope;
  },
  getDeclaredVariables(node) {
    return scopeManager().getDeclaredVariables(node);
  },
  acquire(node, inner) {
    return scopeManager().acquire(node, inner);
  },
});

// Analyzes the file, if nothing has yet. With oxlint, rules get `oxlintScopeManager` in the place of what it returns.
function scopeManager() {
  if (scopeData !== null) return scopeData.manager;
  program();
  const layout = fileDialect === 1 ? eslintScopeLayout() : typescriptLayout();
  const names =
    globalNames.get(fileSettings) ?? globalNames.set(fileSettings, Object.keys(fileSettings.globals)).get(fileSettings);
  const made = native.scopes(fileSettings.freezes ? layout.forOxlint : layout.forNative, names, fileDialect === 0);
  const { 0: listed, 1: nodeToScope, 2: declaredVariables, 3: referenceFlags, 4: explicitGlobals } = made;
  scopeData = { manager: new layout.ScopeManager(listed, nodeToScope, declaredVariables), referenceFlags };
  native.setScopeManager(scopeData.manager);
  // The comments are tokens, which are made here.
  const commentAt = start => sourceCode.getTokenByRangeStart(start, { includeComments: true });
  for (let i = 0; i < explicitGlobals.length; i += 2) {
    explicitGlobals[i].eslintExplicitGlobalComments = explicitGlobals[i + 1].map(commentAt);
  }
  return scopeData.manager;
}

// By the settings of a file: the names of the configured globals.
const globalNames = new WeakMap();
