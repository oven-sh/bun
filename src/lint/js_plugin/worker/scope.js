// ───────────── scopes ─────────────
//
// ESLint's `sourceCode.scopeManager`: the objects of `eslint-scope`, and for the tree of
// typescript-estree those of `@typescript-eslint/scope-manager`, after ESLint has added the global
// variables. Nothing is analyzed or put in order here. `scopes.rs` sends the final answer as arrays of numbers and describes
// them. The objects are made when they are asked for.

// In the order of `ScopeKind` and `DeclarationKind`.
const scopeTypes = [
  "global",
  "module",
  "function",
  "function-expression-name",
  "block",
  "switch",
  "catch",
  "with",
  "for",
  "class",
  "class-field-initializer",
  "class-static-block",
  "tsModule",
  "tsEnum",
  "type",
  "conditionalType",
  "functionType",
  "mappedType",
];
const definitionTypes = [
  "Variable",
  "Parameter",
  "FunctionName",
  "ClassName",
  "CatchClause",
  "ImportBinding",
  "TSEnumName",
  "TSEnumMemberName",
  "TSModuleName",
  "Type",
];

const NO_INDEX = 0xffffffff;
const IS_TYPE = 1;
const IS_VALUE = 2;
const IS_USED = 4;
const IS_EXPORTED = 8;
const IS_ARGUMENTS = 16;
const IS_IN_LIB = 64;
const TO_GLOBAL = 256;
const IS_PARTIAL = 512;

// What is known of the scopes of the file. `null`: not asked for yet.
let scopeData = null;

function resetScopes() {
  scopeData = null;
}

// The indices of the variables for which rules have set `eslintUsed`.
function usedVariables() {
  const used = [];
  if (scopeData === null) return used;
  const { variableObjects, declaredCount } = scopeData;
  for (let index = 0; index < declaredCount; index++) {
    const variable = variableObjects[index];
    if (variable !== undefined && variable.eslintUsed && !(variable.flags & IS_USED)) used.push(index);
  }
  return used;
}

// Defines a property that is computed the first time it is read.
function lazy(prototype, name, compute) {
  Object.defineProperty(prototype, name, {
    get() {
      const value = compute.call(this);
      Object.defineProperty(this, name, { value, writable: true, enumerable: true, configurable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, name, { value, writable: true, enumerable: true, configurable: true });
    },
    enumerable: true,
    configurable: true,
  });
}

class Definition {
  constructor(index) {
    const { definitions } = scopeData;
    const at = 6 * index;
    const nodeAt = id => (id === NO_INDEX ? null : nodes[id]);
    const type = definitionTypes[definitions[at]];
    const flags = definitions[at + 5];
    this.type = type;
    this.name = nodes[definitions[at + 1]];
    this.node = nodeAt(definitions[at + 2]);
    this.parent = nodeAt(definitions[at + 3]);
    if (tree.dialect === 1) {
      this.index = definitions[at + 4] === NO_INDEX ? null : definitions[at + 4];
      this.kind = type === "Variable" ? this.parent.kind : null;
    }
    if (type === "Parameter") this.rest = (flags & 1) !== 0;
    // `eslint-scope` says less about the name of a class in the scope of the class.
    if (flags & 2) this.parent = this.index = this.kind = undefined;
  }
}

// What only `@typescript-eslint/scope-manager` has is in classes of their own: rules ask whether it is there.
class TypeScriptDefinition extends Definition {
  get isTypeDefinition() {
    switch (this.type) {
      case "ClassName":
      case "ImportBinding":
      case "TSEnumName":
      case "TSEnumMemberName":
      case "TSModuleName":
      case "Type":
        return true;
      default:
        return false;
    }
  }
  get isVariableDefinition() {
    return this.type !== "Type";
  }
}

function newDefinition(index) {
  return tree.dialect === 0 ? new TypeScriptDefinition(index) : new Definition(index);
}

function newVariable(name, scope, index, flags) {
  return tree.dialect === 0
    ? new TypeScriptVariable(name, scope, index, flags)
    : new Variable(name, scope, index, flags);
}

class Variable {
  // `index`: in the arrays. `NO_INDEX` for one that isn't there.
  constructor(name, scope, index, flags) {
    this.name = name;
    this.scope = scope;
    this.index = index;
    this.flags = flags;
    this.tainted = false;
    if (flags & IS_USED || tree.dialect === 0) this.eslintUsed = (flags & IS_USED) !== 0;
    if (flags & IS_EXPORTED) this.eslintExported = true;
  }
  get stack() {
    return this.references.every(it => it.from.variableScope === this.scope.variableScope);
  }
}

class TypeScriptVariable extends Variable {
  get $id() {
    return this.index + 1;
  }
  get isTypeVariable() {
    return this.defs.length === 0 && !(this.flags & IS_IN_LIB) ? true : (this.flags & IS_TYPE) !== 0;
  }
  get isValueVariable() {
    return this.defs.length === 0 && !(this.flags & IS_IN_LIB) ? true : (this.flags & IS_VALUE) !== 0;
  }
}
for (const hidden of ["index", "flags"]) Object.defineProperty(Variable.prototype, hidden, { writable: true });
lazy(Variable.prototype, "defs", function () {
  return listAt(scopeData.variables[5 * this.index + 3], newDefinition);
});
lazy(Variable.prototype, "identifiers", function () {
  return this.defs.map(it => it.name).filter(it => it.type !== "Literal");
});
lazy(Variable.prototype, "references", function () {
  return listAt(scopeData.variables[5 * this.index + 4], referenceAt);
});

class Reference {
  constructor(index) {
    const { references } = scopeData;
    const at = 5 * index;
    this.identifier = nodes[references[at]];
    this.from = scopeData.scopes[references[at + 4]];
    this.tainted = false;
    this.flag = references[at + 1] & 3;
    this.index = index;
    if (this.flag & 2) {
      const written = references[at + 2];
      this.writeExpr = written === NO_INDEX ? null : nodes[written];
      this.init = (references[at + 1] & 8) !== 0;
      if (tree.dialect === 1) this.partial = (references[at + 1] & IS_PARTIAL) !== 0;
    }
  }
  isStatic() {
    return !this.tainted && !!this.resolved && this.resolved.scope.isStatic();
  }
  isWrite() {
    return (this.flag & 2) !== 0;
  }
  isRead() {
    return (this.flag & 1) !== 0;
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

class TypeScriptReference extends Reference {
  get $id() {
    return this.index + 1;
  }
  get isTypeReference() {
    return (scopeData.references[5 * this.index + 1] & 4) !== 0;
  }
  get isValueReference() {
    return (scopeData.references[5 * this.index + 1] & 16) !== 0;
  }
}

Reference.READ = 1;
Reference.WRITE = 2;
Reference.RW = 3;
Object.defineProperty(Reference.prototype, "index", { writable: true });
lazy(Reference.prototype, "resolved", function () {
  const variable = scopeData.references[5 * this.index + 3];
  if (variable !== NO_INDEX) return variableAt(variable);
  if (!(scopeData.references[5 * this.index + 1] & TO_GLOBAL)) return null;
  return scopeData.scopes[0].set.get(this.identifier.name) ?? null;
});

function referenceAt(index) {
  return (scopeData.referenceObjects[index] ??=
    tree.dialect === 0 ? new TypeScriptReference(index) : new Reference(index));
}

// What `make` returns for each item of the list at `at`.
function listAt(at, make) {
  const { lists } = scopeData;
  const length = lists[at];
  const list = new Array(length);
  for (let i = 0; i < length; i++) list[i] = make(lists[at + 1 + i]);
  return list;
}

// See `Name` in `scopes.rs`.
function nameOf(word) {
  const number = word >>> 2;
  switch (word & 3) {
    case 0: {
      const node = nodes[number];
      return node.type === "Literal" ? String(node.value) : node.name;
    }
    case 1:
      return "arguments";
    case 2:
      return (scopeData.globalNames ??= Object.keys(fileSettings.globals))[number];
    default:
      return text.slice(scopeData.lists[number + 1], scopeData.lists[number + 2]);
  }
}

function variableAt(index) {
  const existing = scopeData.variableObjects[index];
  if (existing !== undefined) return existing;
  const { variables, scopes, declaredCount } = scopeData;
  const at = 5 * index;
  const scope = scopes[variables[at + 1]];
  const variable = newVariable(nameOf(variables[at]), scope, index, variables[at + 2]);
  scopeData.variableObjects[index] = variable;
  // One that the file doesn't declare, which ESLint has added to the global scope.
  if (index >= declaredCount && scope.index === 0) {
    variable.defs = [];
    variable.identifiers = [];
    Object.defineProperty(variable, "references", {
      get() {
        const found = listAt(variables[at + 4], referenceAt);
        Object.defineProperty(this, "references", { value: found, writable: true, enumerable: true });
        return found;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return variable;
}

class Scope {
  constructor(index, type, block, upper, isStrict) {
    this.type = type;
    this.block = block;
    this.upper = upper;
    this.isStrict = isStrict;
    this.childScopes = [];
    this.variableScope = this;
    this.functionExpressionScope = type === "function-expression-name";
    this.dynamic = type === "global" || type === "with";
    this.directCallToEvalScope = false;
    this.thisFound = false;
    this.taints = new Map();
    this.index = index;
    // The index of the last scope that is in it, or its own.
    this.last = index;
  }
  get $id() {
    return this.index + 1;
  }
  resolve(identifier) {
    return this.references.find(it => it.identifier === identifier) ?? null;
  }
  isStatic() {
    return !this.dynamic;
  }
  isArgumentsMaterialized() {
    if (this.type !== "function") return true;
    if (this.block.type === "ArrowFunctionExpression") return false;
    return this.set.get("arguments").references.length !== 0;
  }
  isThisMaterialized() {
    return true;
  }
  isUsedName(name) {
    return this.set.has(name) || this.through.some(it => it.identifier.name === name);
  }
  // Whether `scope` is this scope or in it.
  contains(scope) {
    return this.index <= scope.index && scope.index <= this.last;
  }
}
for (const hidden of ["index", "last"]) Object.defineProperty(Scope.prototype, hidden, { writable: true });
lazy(Scope.prototype, "variables", function () {
  if (this.index === 0) {
    const mentioned = mentionedGlobals();
    if (tree.dialect === 1) return mentioned;
    const known = new Set(mentioned.map(it => it.name));
    return [
      ...mentioned,
      ...Object.keys(fileSettings.libs)
        .filter(it => !known.has(it))
        .map(it => libVariable(this, it)),
    ];
  }
  return listAt(scopeData.scopeWords[9 * this.index + 6], variableAt);
});
lazy(Scope.prototype, "set", function () {
  if (this.index !== 0 || tree.dialect === 1 || Object.hasOwn(this, "variables"))
    return new Map(this.variables.map(it => [it.name, it]));
  return new GlobalSet(this, mentionedGlobals());
});

// The variables of the global scope that the file declares, refers to or has a comment about, and those of the configuration,
// with what ESLint's `addDeclaredGlobals` sets on them.
function mentionedGlobals() {
  if (scopeData.mentionedGlobals !== null) return scopeData.mentionedGlobals;
  const { scopeWords, globalSettings } = scopeData;
  scopeData.mentionedGlobals = listAt(scopeWords[6], variableAt);
  const commentAt = start => sourceCode.getTokenByRangeStart(start, { includeComments: true });
  for (let at = 0; at < globalSettings.length; at += 3) {
    const variable = variableAt(globalSettings[at]);
    const bits = globalSettings[at + 1];
    // Only a library of TypeScript defines it.
    if (!(bits & 8)) {
      variable.writeable = false;
      variable.eslintImplicitGlobalSetting = "readonly";
      continue;
    }
    variable.eslintImplicitGlobalSetting = ["readonly", "writable", "off", undefined][bits & 3];
    variable.eslintExplicitGlobal = (bits & 16) !== 0;
    variable.eslintExplicitGlobalComments = bits & 16 ? listAt(globalSettings[at + 2], commentAt) : undefined;
    variable.writeable = (bits & 4) !== 0;
  }
  return scopeData.mentionedGlobals;
}

// A variable that the libraries of TypeScript define, and that nothing in the file or in the configuration mentions.
function libVariable(scope, name) {
  let variable = scopeData.libVariables.get(name);
  if (variable === undefined) {
    variable = newVariable(name, scope, NO_INDEX, fileSettings.libs[name] | IS_IN_LIB);
    variable.defs = [];
    variable.identifiers = [];
    variable.references = [];
    variable.writeable = false;
    variable.eslintImplicitGlobalSetting = "readonly";
    scopeData.libVariables.set(name, variable);
  }
  return variable;
}

// The `set` of the global scope with typescript-eslint's parser, which has more than a thousand variables of the libraries of
// TypeScript. Most files ask for a few names. The others are made when something goes through all of them.
class GlobalSet extends Map {
  #scope;
  #isComplete = false;
  constructor(scope, variables) {
    super();
    this.#scope = scope;
    for (const it of variables) super.set(it.name, it);
  }
  #complete() {
    if (this.#isComplete) return;
    this.#isComplete = true;
    for (const it of this.#scope.variables) if (!super.has(it.name)) super.set(it.name, it);
  }
  get(name) {
    const found = super.get(name);
    if (found !== undefined || this.#isComplete || !Object.hasOwn(fileSettings.libs, name)) return found;
    const variable = libVariable(this.#scope, name);
    super.set(name, variable);
    return variable;
  }
  has(name) {
    return super.has(name) || (!this.#isComplete && Object.hasOwn(fileSettings.libs, name));
  }
  get size() {
    this.#complete();
    return super.size;
  }
  keys() {
    this.#complete();
    return super.keys();
  }
  values() {
    this.#complete();
    return super.values();
  }
  entries() {
    this.#complete();
    return super.entries();
  }
  forEach(callback, thisArg) {
    this.#complete();
    return super.forEach(callback, thisArg);
  }
  [Symbol.iterator]() {
    return this.entries();
  }
}
lazy(Scope.prototype, "references", function () {
  return listAt(scopeData.scopeWords[9 * this.index + 7], referenceAt);
});
lazy(Scope.prototype, "through", function () {
  return listAt(scopeData.scopeWords[9 * this.index + 8], referenceAt);
});
// Of the global scope.
lazy(Scope.prototype, "implicit", function () {
  if (this.index !== 0) return undefined;
  const implicit = {
    set: new Map(),
    variables: [],
    [tree.dialect === 1 ? "left" : "leftToBeResolved"]: [...this.through],
  };
  for (const list of scopeData.implicitGlobals) {
    const pairs = listAt(list, it => it);
    const variable = newVariable(nodes[pairs[0]].name, this, NO_INDEX, 0);
    variable.defs = [];
    variable.identifiers = [];
    variable.references = [];
    implicit.set.set(variable.name, variable);
    implicit.variables.push(variable);
    for (let at = 0; at < pairs.length; at += 2) {
      const definition = Object.create((tree.dialect === 0 ? TypeScriptDefinition : Definition).prototype);
      Object.assign(definition, {
        type: "ImplicitGlobalVariable",
        name: nodes[pairs[at]],
        node: pairs[at + 1] === NO_INDEX ? null : nodes[pairs[at + 1]],
        parent: null,
      });
      if (tree.dialect === 1) Object.assign(definition, { index: null, kind: null });
      variable.defs.push(definition);
      variable.identifiers.push(nodes[pairs[at]]);
    }
  }
  return implicit;
});

class ScopeManager {
  constructor(scopes) {
    this.scopes = scopes;
    this.globalScope = scopes[0];
    this.currentScope = null;
  }
  get variables() {
    return this.scopes.flatMap(it => it.variables);
  }
  isES6() {
    return tree.dialect === 0 || fileSettings.languageOptions.ecmaVersion >= 6;
  }
  isGlobalReturn() {
    const { sourceType, parserOptions } = fileSettings.languageOptions;
    return parserOptions.ecmaFeatures?.globalReturn === true || (tree.dialect === 1 && sourceType === "commonjs");
  }
  isImpliedStrict() {
    return fileSettings.languageOptions.parserOptions.ecmaFeatures?.impliedStrict === true;
  }
  isModule() {
    const { sourceType, parserOptions } = fileSettings.languageOptions;
    return ((tree.dialect === 0 && parserOptions.sourceType) || sourceType) === "module";
  }
  isStrictModeSupported() {
    return tree.dialect === 0 || fileSettings.languageOptions.ecmaVersion >= 5;
  }
  getDeclaredVariables(node) {
    return this.declaredVariables.get(node) ?? [];
  }
  acquire(node, inner = false) {
    const scopes = this.nodeToScope.get(node);
    if (scopes === undefined) return null;
    if (scopes.length === 1) return scopes[0];
    return (inner ? scopes.at(-1) : scopes[0]) ?? null;
  }
  acquireAll(node) {
    return this.nodeToScope.get(node);
  }
  release(node, inner) {
    const upper = this.nodeToScope.get(node)?.[0].upper;
    return upper ? this.acquire(upper.block, inner) : null;
  }
  attach() {}
  detach() {}
}
lazy(ScopeManager.prototype, "nodeToScope", function () {
  const byNode = new Map();
  for (const scope of this.scopes) {
    const scopes = byNode.get(scope.block);
    if (scopes === undefined) byNode.set(scope.block, [scope]);
    else scopes.push(scope);
  }
  return byNode;
});
lazy(ScopeManager.prototype, "declaredVariables", function () {
  const byNode = new Map();
  const add = (node, variable) => {
    if (node === null || node === undefined) return;
    const variables = byNode.get(node);
    if (variables === undefined) byNode.set(node, [variable]);
    else if (!variables.includes(variable)) variables.push(variable);
  };
  for (const scope of this.scopes) {
    for (const variable of scope.index === 0 ? [...scope.variables, ...scope.implicit.variables] : scope.variables) {
      for (const definition of variable.defs) {
        add(definition.node, variable);
        add(definition.parent, variable);
      }
    }
  }
  return byNode;
});

function scopeManager() {
  if (scopeData !== null) return scopeData.manager;
  program();
  ask(SCOPES);
  const buffer = buffers[SCOPES];
  const [
    scopeCount,
    declaredCount,
    variableCount,
    definitionCount,
    referenceCount,
    settingCount,
    implicitCount,
    listLength,
    listed,
  ] = new Uint32Array(buffer, 0, 9);
  let at = 36;
  const words = length => {
    const part = new Uint32Array(buffer, at, length);
    at += 4 * length;
    return part;
  };
  const scopeWords = words(9 * scopeCount);
  const scopes = [];
  scopeData = {
    manager: null,
    scopes,
    scopeWords,
    declaredCount,
    variables: words(5 * variableCount),
    definitions: words(6 * definitionCount),
    references: words(5 * referenceCount),
    globalSettings: words(3 * settingCount),
    implicitGlobals: words(implicitCount),
    lists: words(listLength),
    variableObjects: new Array(variableCount),
    referenceObjects: new Array(referenceCount),
    libVariables: new Map(),
    mentionedGlobals: null,
    globalNames: null,
  };
  for (let index = 0; index < scopeCount; index++) {
    const kind = scopeWords[9 * index];
    const upper = scopeWords[9 * index + 2];
    const scope = new Scope(
      index,
      scopeTypes[kind & 255],
      nodes[scopeWords[9 * index + 1]],
      upper === NO_INDEX ? null : scopes[upper],
      (kind & 256) !== 0,
    );
    scope.variableScope = scopes[scopeWords[9 * index + 3]] ?? scope;
    scope.last = scopeWords[9 * index + 4];
    scopes.push(scope);
  }
  for (const scope of scopes) scope.childScopes = listAt(scopeWords[9 * scope.index + 5], index => scopes[index]);
  scopeData.manager = new ScopeManager(listAt(listed, index => scopes[index]));
  return scopeData.manager;
}
