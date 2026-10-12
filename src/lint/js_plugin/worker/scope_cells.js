// ───────────── scopes ─────────────
//
// ESLint's `sourceCode.scopeManager`. `scopes.rs` sends the final answer as arrays of numbers, and `native.scopes`
// (src/jsc/bindings/LintScopes.cpp) builds all the objects of a file in one call. What is here are the classes of `eslint-scope` and
// of `@typescript-eslint/scope-manager` with their public methods, and which property goes where.

// `{ manager, variables, words }` of the file. `null`: nobody has asked for the scopes yet.
let scopeData = null;

function resetScopes() {
  scopeData = null;
}

// The indices of the variables for which rules have set `eslintUsed`.
function usedVariables() {
  const used = [];
  if (scopeData === null) return used;
  const { variables, words, declaredCount } = scopeData;
  for (let index = 0; index < declaredCount; index++) {
    if (variables[index].eslintUsed && !(words[8 * index + 2] & 4)) used.push(index);
  }
  return used;
}

const namesIn = text => text.split(/\s+/u);

// The numbers of `Field` in LintScopes.cpp, by the name of the property. Any other property has the value of the template.
const scopeFields = Object.fromEntries(
  [
    "",
    ...namesIn(`$id set taints block through variables references variableScope upper isStrict thisFound childScopes
    __declaredVariables implicit name identifiers defs stack scope eslintUsed eslintExported
    eslintImplicitGlobalSetting eslintExplicitGlobal writeable isTypeVariable isValueVariable node parent index
    kind rest identifier from resolved flag writeExpr partial init tainted`),
  ].map((name, field) => [name, field]),
);

// A template and its program for objects of `type` with the properties `keys`. `constants`: the values of those that are the same
// in all of them. `fields`: other names for a field.
function scopeShape(type, keys, constants = {}, fields = {}) {
  const template = native.shape(type.prototype, keys, undefined);
  for (const key of keys) if (key in constants) template[key] = constants[key];
  const fieldOf = key => (key in constants ? 0 : (scopeFields[fields[key] ?? key] ?? 0));
  return [template, Uint8Array.from(keys, fieldOf)];
}

// In the order of `ScopeKind` and `DeclarationKind`.
const scopeTypes =
  namesIn(`global module function function-expression-name block switch catch with for class class-field-initializer
    class-static-block tsModule tsEnum type conditionalType functionType mappedType`);
const definitionTypes =
  namesIn(`Variable Parameter FunctionName ClassName CatchClause ImportBinding TSEnumName TSEnumMemberName TSModuleName
    Type ImplicitGlobalVariable`);
const scopeStrings = ["arguments", "readonly", "writable", "off", "var", "let", "const", "using", "await using"];

// The shapes of a variable, by which properties it has besides `base`: see `SHAPE_GLOBAL` in `scopes.rs`.
function variableShapes(type, libType, base, libKeys, constants) {
  const ofESLint = ["eslintImplicitGlobalSetting", "eslintExplicitGlobal", "eslintExplicitGlobalComments", "writeable"];
  return Array.from({ length: 16 }, (_, shape) => {
    const isPossible =
      (shape & 3) !== 3 && !(shape & 2 && libType === null) && !(shape & 4 && base.includes("eslintUsed"));
    if (!isPossible) return [undefined, undefined];
    const keys = [...base, ...(shape & 1 ? ofESLint : []), ...(shape & 2 ? libKeys : [])];
    if (shape & 4) keys.push("eslintUsed");
    if (shape & 8) keys.push("eslintExported");
    return scopeShape(shape & 2 ? libType : type, keys, constants);
  }).flat();
}

// ───────────── `eslint-scope` ─────────────

const eslintScopeLayout = (() => {
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
  const keys = namesIn(`type set taints dynamic block through variables references variableScope functionExpressionScope
    directCallToEvalScope thisFound __left upper isStrict childScopes __declaredVariables`);
  const scopes = types.flatMap((type, kind) =>
    scopeShape(type, kind === 0 ? [...keys, "implicit"] : keys, {
      type: scopeTypes[kind],
      dynamic: kind === 0 || scopeTypes[kind] === "with",
      functionExpressionScope: scopeTypes[kind] === "function-expression-name",
      directCallToEvalScope: false,
      __left: null,
    }),
  );

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
  const variableKeys = ["name", "identifiers", "references", "defs", "tainted", "stack", "scope"];

  class Definition {}
  class ParameterDefinition extends Definition {}
  const definitionKeys = ["type", "name", "node", "parent", "index", "kind"];
  const definitions = definitionTypes.flatMap(type => {
    if (type === "Parameter")
      return scopeShape(ParameterDefinition, [...definitionKeys, "rest"], { type, parent: null, kind: null });
    if (type === "ImplicitGlobalVariable")
      return scopeShape(Definition, definitionKeys, { type, parent: null, index: null, kind: null });
    return scopeShape(Definition, definitionKeys, { type });
  });

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
  const referenceKeys = written => [
    "identifier",
    "from",
    "tainted",
    "resolved",
    "flag",
    ...written,
    "__maybeImplicitGlobal",
  ];
  const references = [[], ["writeExpr", "partial", "init"]].flatMap(written =>
    scopeShape(Reference, referenceKeys(written)),
  );

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
        childVisitorKeys: visitorKeys[1],
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
    forNative: [
      scopes,
      variableShapes(Variable, null, variableKeys, [], { eslintExplicitGlobalComments: undefined }),
      definitions,
      references,
      scopeShape(Object, ["set", "variables", "left"], {}, { left: "through" }),
      [new Map(), new WeakMap(), new Map()],
    ],
  };
})();

// ───────────── `@typescript-eslint/scope-manager` ─────────────

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

const typescriptLayout = (() => {
  class ScopeBase {
    isVariableScope() {
      return this.variableScope === this;
    }
  }
  const names =
    namesIn(`GlobalScope ModuleScope FunctionScope FunctionExpressionNameScope BlockScope SwitchScope CatchScope WithScope
    ForScope ClassScope ClassFieldInitializerScope ClassStaticBlockScope TSModuleScope TSEnumScope TypeScope
    ConditionalTypeScope FunctionTypeScope MappedTypeScope`);
  // A class called `name`.
  const subclass = (name, base) => ({ [name]: class extends base {} })[name];
  const keys =
    namesIn(`$id block childScopes functionExpressionScope isStrict leftToResolve references set through type upper
    variables variableScope`);
  const scopes = names.flatMap((name, kind) =>
    scopeShape(subclass(name, ScopeBase), kind === 0 ? [...keys, "implicit"] : keys, {
      functionExpressionScope: scopeTypes[kind] === "function-expression-name",
      leftToResolve: null,
      type: scopeTypes[kind],
    }),
  );

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
  const variableKeys = ["$id", "defs", "eslintUsed", "identifiers", "name", "references", "scope"];
  const libKeys =
    namesIn(`writeable eslintExplicitGlobal eslintImplicitGlobalSetting eslintExplicitGlobalComments isTypeVariable
    isValueVariable`);

  class DefinitionBase {}
  const definitionKeys = ["$id", "type", "name", "node", "parent", "isTypeDefinition", "isVariableDefinition"];
  const typeDefinitions = ["ClassName", "ImportBinding", "TSEnumName", "TSEnumMemberName", "TSModuleName", "Type"];
  const definitions = definitionTypes.flatMap(type => {
    const name = `${type === "TSEnumMemberName" ? "TSEnumMember" : type}Definition`;
    const constants = { type, isTypeDefinition: typeDefinitions.includes(type), isVariableDefinition: type !== "Type" };
    if (type === "ImplicitGlobalVariable") constants.parent = null;
    return scopeShape(
      subclass(name, DefinitionBase),
      type === "Parameter" ? [...definitionKeys, "rest"] : definitionKeys,
      constants,
    );
  });

  // The flags of a reference, which the real one has in private fields, are in the message.
  const flagsOf = reference => scopeData.references[5 * (reference.$id - 1) + 1];
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
  const reference = scopeShape(Reference, [
    "$id",
    "from",
    "identifier",
    "init",
    "maybeImplicitGlobal",
    "resolved",
    "writeExpr",
  ]);

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
    forNative: [
      scopes,
      variableShapes(Variable, ImplicitLibVariable, variableKeys, libKeys, { eslintExplicitGlobalComments: undefined }),
      definitions,
      [...reference, ...reference],
      scopeShape(Object, ["leftToBeResolved", "set", "variables"], {}, { leftToBeResolved: "through" }),
      [new Map(), new WeakMap(), new GlobalSet()],
    ],
  };
})();

// A variable that the libraries of TypeScript define, and that nothing in the file or in the configuration mentions.
function libVariable(name) {
  let variable = scopeData.libVariables.get(name);
  if (variable === undefined) {
    const flags = fileSettings.libs[name];
    variable = {
      __proto__: typescriptLayout.ImplicitLibVariable.prototype,
      $id: scopeData.variables.length + scopeData.libVariables.size + 1,
      defs: [],
      eslintUsed: false,
      identifiers: [],
      name,
      references: [],
      scope: scopeData.manager.globalScope,
      writeable: false,
      eslintExplicitGlobal: false,
      eslintImplicitGlobalSetting: "readonly",
      eslintExplicitGlobalComments: undefined,
      isTypeVariable: (flags & 1) !== 0,
      isValueVariable: (flags & 2) !== 0,
    };
    scopeData.libVariables.set(name, variable);
  }
  return variable;
}

// Puts the rest of them into `variables` and `set` of the global scope.
function addLibVariables() {
  if (scopeData.hasAllLibVariables) return;
  scopeData.hasAllLibVariables = true;
  const { globalScope } = scopeData.manager;
  const variables = scopeData.mentionedGlobals;
  const known = new Set(variables.map(it => it.name));
  for (const name of Object.keys(fileSettings.libs)) {
    if (known.has(name)) continue;
    const variable = libVariable(name);
    variables.push(variable);
    Map.prototype.set.call(globalScope.set, name, variable);
  }
  Object.defineProperty(globalScope, "variables", {
    value: variables,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function scopeManager() {
  if (scopeData !== null) return scopeData.manager;
  program();
  ask(SCOPES);
  const buffer = buffers[SCOPES];
  const [scopeCount, declaredCount, variableCount, definitionCount, referenceCount] = new Uint32Array(buffer, 0, 5);
  const layout = tree.dialect === 1 ? eslintScopeLayout : typescriptLayout;
  const names =
    globalNames.get(fileSettings) ?? globalNames.set(fileSettings, Object.keys(fileSettings.globals)).get(fileSettings);
  const [listed, scopes, variables, nodeToScope, declaredVariables] = native.scopes(
    layout.forNative,
    buffer,
    nodes,
    names,
    scopeStrings,
    text,
  );
  const words = new Uint32Array(buffer, 44 + 36 * scopeCount, 8 * variableCount);
  scopeData = {
    manager: new layout.ScopeManager(listed, nodeToScope, declaredVariables),
    variables,
    words,
    declaredCount,
    references: new Uint32Array(
      buffer,
      44 + 36 * scopeCount + 32 * variableCount + 28 * definitionCount,
      5 * referenceCount,
    ),
    libVariables: new Map(),
    mentionedGlobals: scopes[0].variables,
    hasAllLibVariables: tree.dialect === 1,
  };
  // The comments are tokens, which are made here.
  const lists = new Uint32Array(buffer);
  const commentAt = start => sourceCode.getTokenByRangeStart(start, { includeComments: true });
  for (const variable of scopes[0].variables) {
    if (!variable.eslintExplicitGlobal) continue;
    const index = variables.indexOf(variable);
    const at = listsStart(lists) + words[8 * index + 7];
    variable.eslintExplicitGlobalComments = Array.from(lists.subarray(at + 1, at + 1 + lists[at]), commentAt);
  }
  if (tree.dialect === 0) {
    Object.defineProperty(scopes[0], "variables", {
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

// Where the lists start in the words of the message.
function listsStart(words) {
  return 11 + 9 * words[0] + 8 * words[2] + 7 * words[3] + 5 * words[4] + words[5];
}
