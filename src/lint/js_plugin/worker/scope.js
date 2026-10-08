// ───────────── scopes ─────────────
//
// ESLint's `sourceCode.scopeManager`: the objects of `eslint-scope`, and for the tree of
// typescript-estree those of `@typescript-eslint/scope-manager`, after ESLint has added the global
// variables. Nothing is analyzed here: what is in which scope and what refers to what is in the
// arrays that `scopes.rs` describes. The objects are made when they are asked for.

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
const IS_WRITABLE = 32;
const IS_IN_LIB = 64;
const IS_CONFIGURED = 128;
const TO_GLOBAL = 256;

// What is known of the scopes of the file. `null`: not asked for yet.
let scopeData = null;

function resetScopes() {
  scopeData = null;
}

// The indices of the variables for which rules have set `eslintUsed`.
function usedVariables() {
  const used = [];
  if (scopeData === null) return used;
  const { variableObjects, variableCount } = scopeData;
  for (let index = 0; index < variableCount; index++) {
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

function closest(node, types) {
  let found = node;
  while (found !== null && !types.has(found.type)) found = found.parent;
  return found;
}

const functionTypes = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
  "TSFunctionType",
  "TSConstructorType",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSMethodSignature",
]);
const declaratorTypes = new Set(["VariableDeclarator"]);
const catchTypes = new Set(["CatchClause"]);
const assigningTypes = new Set(["AssignmentExpression", "ForInStatement", "ForOfStatement"]);

class Definition {
  constructor(type, name) {
    this.type = type;
    this.name = name;
    let node = name.parent;
    let parent = null;
    switch (type) {
      case "Variable":
        node = closest(name, declaratorTypes);
        parent = node.parent;
        break;
      case "Parameter":
        node = closest(name, functionTypes);
        break;
      case "CatchClause":
        node = closest(name, catchTypes);
        break;
      case "ImportBinding":
        parent = node.type === "TSImportEqualsDeclaration" ? node : node.parent;
        break;
      case "TSModuleName":
        while (node.type !== "TSModuleDeclaration") node = node.parent;
        break;
    }
    this.node = node;
    this.parent = parent;
    if (tree.dialect === 1) {
      this.index = null;
      this.kind = null;
      if (type === "Variable") {
        this.index = parent.declarations.indexOf(node);
        this.kind = parent.kind;
      }
    }
    if (type === "Parameter") {
      let parameter = name;
      while (parameter.parent !== node) parameter = parameter.parent;
      if (tree.dialect === 1) this.index = node.params.indexOf(parameter);
      this.rest = name.parent.type === "RestElement" && name.parent.argument === name;
    }
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

function newDefinition(type, name) {
  return tree.dialect === 0 ? new TypeScriptDefinition(type, name) : new Definition(type, name);
}

function newVariable(name, scope, index, flags) {
  return tree.dialect === 0 ? new TypeScriptVariable(name, scope, index, flags) : new Variable(name, scope, index, flags);
}

// `eslint-scope` says less about the name of a class in the scope of the class.
function forgetParent(definition) {
  if (tree.dialect === 1 && definition.type === "ClassName") {
    definition.parent = definition.index = definition.kind = undefined;
  }
}

class Variable {
  // `index`: in the arrays, if it is there.
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
  const { variables, definitions, variableCount } = scopeData;
  const defs = [];
  if (this.index < variableCount) {
    for (let at = variables[2 * this.index]; at < variables[2 * this.index + 2]; at++) {
      const name = definitions[2 * at];
      if (name !== NO_INDEX) defs.push(newDefinition(definitionTypes[definitions[2 * at + 1]], nodes[name]));
    }
  }
  if (this.scope.type === "class") defs.forEach(forgetParent);
  return defs;
});
lazy(Variable.prototype, "identifiers", function () {
  return this.defs.map(it => it.name).filter(it => it.type !== "Literal");
});
lazy(Variable.prototype, "references", function () {
  return scopeData.referencesByVariable().of(this.index).map(referenceAt);
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
      if (tree.dialect === 1) {
        this.partial = /^(?:Property|ArrayPattern|RestElement|AssignmentPattern)$/u.test(this.identifier.parent.type);
      }
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
  const variable = scopeData.resolved[this.index];
  if (variable !== NO_INDEX) return variableAt(variable);
  if (!(scopeData.references[5 * this.index + 1] & TO_GLOBAL)) return null;
  return scopeData.scopes[0].set.get(this.identifier.name) ?? null;
});

function referenceAt(index) {
  return (scopeData.referenceObjects[index] ??= (tree.dialect === 0 ? new TypeScriptReference(index) : new Reference(index)));
}

function nameOfDefinition(node) {
  return node.type === "Literal" ? String(node.value) : node.name;
}

function variableAt(index) {
  const existing = scopeData.variableObjects[index];
  if (existing !== undefined) return existing;
  const { variables, definitions, scopes, scopeWords } = scopeData;
  // The last scope whose first variable is not after it.
  let low = 0;
  let high = scopes.length;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (scopeWords[5 * middle + 4] <= index) low = middle;
    else high = middle;
  }
  while (scopeWords[5 * (low + 1) + 4] <= index) low++;
  const flags = variables[2 * index + 1];
  const name = flags & IS_ARGUMENTS ? "arguments" : nameOfDefinition(nodes[definitions[2 * variables[2 * index]]]);
  return (scopeData.variableObjects[index] = newVariable(name, scopes[low], index, flags));
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
    const mentioned = mentionedGlobals(this);
    if (tree.dialect === 1) return mentioned;
    const known = new Set(mentioned.map(it => it.name));
    return [...mentioned, ...Object.keys(fileSettings.libs).filter(it => !known.has(it)).map(it => libVariable(this, it))];
  }
  const { scopeWords, innerClassNames } = scopeData;
  const variables = [];
  const inner = innerClassNames.get(this.index);
  if (inner !== undefined) variables.push(variableAt(inner));
  for (let at = scopeWords[5 * this.index + 4]; at < scopeWords[5 * this.index + 9]; at++) variables.push(variableAt(at));
  // typescript-eslint comes to the type parameters of a function after its parameters.
  if (this.type === "function" && this.block.typeParameters) {
    const rank = variable => {
      const kind = scopeData.definitions[2 * scopeData.variables[2 * variable.index] + 1];
      if (variable.flags & IS_ARGUMENTS) return 0;
      if (kind === 1) return 1;
      return kind === 9 && variable.defs[0].node.parent === this.block.typeParameters ? 2 : 3;
    };
    const ranks = new Map(variables.map(it => [it, rank(it)]));
    variables.sort((a, b) => ranks.get(a) - ranks.get(b));
  }
  return variables;
});
lazy(Scope.prototype, "set", function () {
  if (this.index !== 0 || tree.dialect === 1 || Object.hasOwn(this, "variables")) return new Map(this.variables.map(it => [it.name, it]));
  return new GlobalSet(this, mentionedGlobals(this));
});

// The variables of the global scope that the file declares, refers to or has a comment about, and those of the configuration.
function mentionedGlobals(scope) {
  if (scopeData.mentionedGlobals === null) {
    const variables = (scopeData.mentionedGlobals = []);
    for (let at = scopeData.scopeWords[4]; at < scopeData.scopeWords[9]; at++) variables.push(variableAt(at));
    addGlobalVariables(scope, variables);
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
  return scopeData.referencesByScope().of(this.index).map(referenceAt);
});
lazy(Scope.prototype, "through", function () {
  const { references, resolved, scopes, variableScopes } = scopeData;
  const [first, last] = scopeData.referenceRange(this);
  const through = [];
  for (let index = first; index <= last; index++) {
    const from = references[5 * index + 4];
    if (from < this.index || from > this.last) continue;
    const variable = resolved[index];
    if (variable === NO_INDEX) {
      if (this.index !== 0 || !(references[5 * index + 1] & TO_GLOBAL)) through.push(referenceAt(index));
    } else if (!this.contains(scopes[variableScopes()[variable]])) through.push(referenceAt(index));
  }
  return through;
});
// Of the global scope.
lazy(Scope.prototype, "implicit", function () {
  if (this.index !== 0) return undefined;
  const implicit = { set: new Map(), variables: [], [tree.dialect === 1 ? "left" : "leftToBeResolved"]: [...this.through] };
  for (const reference of this.through) {
    if (!reference.isWriteOnly() || reference.init || reference.from.isStrict) continue;
    const { name } = reference.identifier;
    let variable = implicit.set.get(name);
    if (variable === undefined) {
      variable = newVariable(name, this, NO_INDEX, 0);
      variable.defs = [];
      variable.identifiers = [];
      variable.references = [];
      implicit.set.set(name, variable);
      implicit.variables.push(variable);
    }
    const definition = Object.create((tree.dialect === 0 ? TypeScriptDefinition : Definition).prototype);
    Object.assign(definition, {
      type: "ImplicitGlobalVariable",
      name: reference.identifier,
      node: closest(reference.identifier, assigningTypes),
      parent: null,
    });
    if (tree.dialect === 1) Object.assign(definition, { index: null, kind: null });
    variable.defs.push(definition);
    variable.identifiers.push(reference.identifier);
  }
  return implicit;
});

// Adds what the file does not declare to the variables of the global scope: ESLint's `addDeclaredGlobals`,
// and of the variables that the libraries of TypeScript define those that the file refers to.
function addGlobalVariables(scope, variables) {
  const { globals, references, inComments } = scopeData;
  const byName = new Map(variables.map(it => [it.name, it]));
  // By name: the flags of what is referred to.
  const referred = new Map();
  for (let at = 0; at < globals.length; at += 2) {
    referred.set(nodes[references[5 * globals[at]]].name, globals[at + 1]);
  }
  const define = name => {
    let variable = byName.get(name);
    if (variable === undefined) {
      variable = newVariable(name, scope, NO_INDEX, referred.get(name) ?? 0);
      variable.defs = [];
      variable.identifiers = [];
      Object.defineProperty(variable, "references", {
        get() {
          let found = scopeData.referencesToGlobals().get(name) ?? [];
          // typescript-eslint resolves what the libraries say the name can be: `Promise` is only a type in the first of them
          // that has it. ESLint resolves the rest afterwards.
          if (tree.dialect === 0 && found.length > 1) {
            const isFirst = it => (it.isTypeReference && this.isTypeVariable) || (it.isValueReference && this.isValueVariable);
            found = [...found.filter(isFirst), ...found.filter(it => !isFirst(it))];
          }
          Object.defineProperty(this, "references", { value: found, writable: true, enumerable: true });
          return found;
        },
        enumerable: true,
        configurable: true,
      });
      byName.set(name, variable);
      variables.push(variable);
    }
    return variable;
  };
  for (const [name, flags] of referred) {
    if (flags & IS_CONFIGURED) continue;
    const variable = define(name);
    variable.writeable = false;
    variable.eslintImplicitGlobalSetting = "readonly";
  }
  const configured = fileSettings.globals;
  for (const name of Object.keys(configured)) {
    const comment = inComments.get(name);
    const setting = comment?.setting ?? configured[name];
    if (setting === "off") continue;
    const variable = define(name);
    variable.eslintImplicitGlobalSetting = configured[name];
    variable.eslintExplicitGlobal = comment !== undefined;
    variable.eslintExplicitGlobalComments = comment?.comments();
    variable.writeable = setting === "writable";
  }
  for (const [name, comment] of inComments) {
    if (name in configured || comment.setting === "off") continue;
    const variable = define(name);
    variable.eslintImplicitGlobalSetting = undefined;
    variable.eslintExplicitGlobal = true;
    variable.eslintExplicitGlobalComments = comment.comments();
    variable.writeable = comment.setting === "writable";
  }
}

// The numbers from 0 to `count` grouped by `keyOf`, which is less than `keys` or `NO_INDEX`.
function group(count, keys, keyOf) {
  const starts = new Uint32Array(keys + 1);
  for (let i = 0; i < count; i++) {
    const key = keyOf(i);
    if (key !== NO_INDEX) starts[key + 1]++;
  }
  for (let key = 0; key < keys; key++) starts[key + 1] += starts[key];
  const next = starts.slice(0, keys);
  const grouped = new Uint32Array(starts[keys]);
  for (let i = 0; i < count; i++) {
    const key = keyOf(i);
    if (key !== NO_INDEX) grouped[next[key]++] = i;
  }
  return { of: key => (key < keys ? Array.from(grouped.subarray(starts[key], starts[key + 1])) : []) };
}

function memoize(compute) {
  let value;
  return () => (value ??= compute());
}

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

// The types of the nodes whose children typescript-eslint's scope manager does not visit in the order of the source, by number.
let outOfOrder = null;

// `count` things in the order of the source, each at the node `nodeOf` says, that can be put in another order.
class Order {
  constructor(count, nodeOf) {
    this.count = count;
    this.nodeOf = nodeOf;
    // The things by their nodes, where each is in the order, and which is at each place of it.
    this.sorted = Uint32Array.from({ length: count }, (_, index) => index).sort((a, b) => nodeOf(a) - nodeOf(b));
    this.place = Uint32Array.from({ length: count }, (_, index) => index);
    this.order = this.place.slice();
    this.hasMoved = false;
  }
  // The first of `sorted` that is not before the node `id`.
  lowerBound(id) {
    let [low, high] = [0, this.count];
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.nodeOf(this.sorted[middle]) < id) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  // The places of what is in `ranges` of nodes, each `[first, last]`, if they are next to each other.
  places(ranges) {
    let [low, high, found] = [this.count, 0, 0];
    for (const [from, to] of ranges) {
      if (from > to) continue;
      const stop = this.lowerBound(to + 1);
      for (let i = this.lowerBound(from); i < stop; i++) {
        const at = this.place[this.sorted[i]];
        if (at < low) low = at;
        if (at > high) high = at;
        found++;
      }
    }
    return found > 0 && high - low === found - 1 ? [low, high] : null;
  }
  // What is at the places `before` comes after what is at the places `after`, which follow.
  exchange(before, after) {
    if (!before || !after || before[1] + 1 !== after[0]) return;
    const { order, place } = this;
    const moved = order.slice(before[0], before[1] + 1);
    order.copyWithin(before[0], after[0], after[1] + 1);
    order.set(moved, before[0] + after[1] - after[0] + 1);
    for (let at = before[0]; at <= after[1]; at++) place[order[at]] = at;
    this.hasMoved = true;
  }
}

// Puts what comes in the order of the source in the order in which typescript-eslint's scope manager comes to it: to a type
// annotation after the value, to type arguments after the arguments, to the type parameters of a function after its
// parameters, and to decorators last.
function orderAsTypeScriptEslint(orders) {
  if (outOfOrder === null) {
    outOfOrder = new Uint8Array(256);
    const kinds = {
      VariableDeclarator: 1,
      FunctionDeclaration: 2,
      FunctionExpression: 2,
      ArrowFunctionExpression: 2,
      TSDeclareFunction: 2,
      TSEmptyBodyFunctionExpression: 2,
      ClassDeclaration: 3,
      ClassExpression: 3,
      PropertyDefinition: 4,
      AccessorProperty: 4,
      TSAbstractPropertyDefinition: 4,
      TSAbstractAccessorProperty: 4,
      MethodDefinition: 4,
      TSAbstractMethodDefinition: 4,
      CallExpression: 5,
      NewExpression: 5,
      TaggedTemplateExpression: 5,
      TSTypeAssertion: 6,
    };
    for (const [name, kind] of Object.entries(kinds)) outOfOrder[typeIds.get(name)] = kind;
  }
  const { types, count: nodeCount } = tree;
  const last = lastDescendants();
  const [DECORATOR, ANNOTATION, PARAMETERS, ARGUMENTS, ASSIGNMENT, PROPERTY] = [
    "Decorator",
    "TSTypeAnnotation",
    "TSTypeParameterDeclaration",
    "TSTypeParameterInstantiation",
    "AssignmentPattern",
    "TSParameterProperty",
  ].map(it => typeIds.get(it));

  // What is in the ranges of nodes `before` comes after what is in the ranges `after`.
  const exchange = (before, after) => {
    for (const it of orders) it.exchange(it.places(before), it.places(after));
  };
  const swap = (first, middle, end) => exchange([[first, middle]], [[middle + 1, end]]);
  // The last of the decorators that `id` starts with, or the node before its first child.
  const decoratorsOf = id => {
    let end = id;
    while (end < last[id] && types[end + 1] === DECORATOR) end = last[end + 1];
    return end;
  };
  // The annotation of the pattern `id`, which is its last child.
  const annotationOf = id => {
    let child = id + 1;
    if (child > last[id]) return 0;
    while (last[child] < last[id]) child = last[child] + 1;
    return types[child] === ANNOTATION ? child : 0;
  };
  // `isOfMethod`: the decorators of the parameters of a method come before all of them.
  const parameter = (id, isOfMethod) => {
    const decorators = decoratorsOf(id);
    if (types[id] === PROPERTY) parameter(decorators + 1, isOfMethod);
    else if (types[id] === ASSIGNMENT) {
      const left = decorators + 1;
      const annotation = annotationOf(left);
      if (annotation !== 0) swap(annotation, last[left], last[id]);
    }
    if (!isOfMethod) swap(id + 1, decorators, last[id]);
  };

  for (let id = 0; id < nodeCount; id++) {
    const kind = outOfOrder[types[id]];
    if (kind === 0 || last[id] === id) continue;
    if (kind === 1) {
      const annotation = annotationOf(id + 1);
      if (annotation !== 0) swap(annotation, last[id + 1], last[id]);
    } else if (kind === 2) {
      const node = nodes[id];
      let child = node.id ? last[id + 1] + 1 : id + 1;
      const typeParameters = types[child] === PARAMETERS ? child : 0;
      if (typeParameters !== 0) child = last[child] + 1;
      let end = child - 1;
      const isOfMethod = node.parent.type === "MethodDefinition" || node.parent.type === "TSAbstractMethodDefinition";
      // The parameters so far, without their decorators.
      const undecorated = [];
      for (let i = 0; i < node.params.length; i++) {
        parameter(child, isOfMethod);
        if (isOfMethod) {
          const decorators = decoratorsOf(child);
          exchange(undecorated, [[child + 1, decorators]]);
          undecorated.push([decorators + 1, last[child]]);
        }
        end = last[child];
        child = end + 1;
      }
      if (node.returnType) end = last[child];
      if (typeParameters !== 0) swap(typeParameters, last[typeParameters], end);
    } else if (kind === 3) {
      const node = nodes[id];
      if (!node.typeParameters || !node.superClass) continue;
      let child = decoratorsOf(id) + 1;
      if (node.id) child = last[child] + 1;
      swap(child, last[child], last[last[child] + 1]);
    } else if (kind === 4) {
      const decorators = decoratorsOf(id);
      const key = decorators + 1;
      const annotation = last[key] < last[id] && types[last[key] + 1] === ANNOTATION ? last[key] + 1 : 0;
      if (annotation === 0) swap(id + 1, decorators, last[id]);
      else {
        swap(annotation, last[annotation], last[id]);
        exchange(
          [[id + 1, decorators]],
          [
            [key, last[key]],
            [last[annotation] + 1, last[id]],
          ],
        );
      }
    } else if (kind === 5) {
      const typeArguments = last[id + 1] + 1;
      if (typeArguments <= last[id] && types[typeArguments] === ARGUMENTS) swap(typeArguments, last[typeArguments], last[id]);
    } else swap(id + 1, last[id + 1], last[id]);
  }
}

function scopeManager() {
  if (scopeData !== null) return scopeData.manager;
  program();
  ask(SCOPES);
  const buffer = buffers[SCOPES];
  const [scopeCount, variableCount, definitionCount, referenceCount, globalCount, commentCount] = new Uint32Array(buffer, 0, 6);
  let at = 24;
  const words = length => {
    const part = new Uint32Array(buffer, at, length);
    at += 4 * length;
    return part;
  };
  const scopeWords = words(5 * (scopeCount + 1));
  const variables = words(2 * (variableCount + 1));
  const definitions = words(2 * definitionCount);
  const references = words(5 * referenceCount);
  const globals = words(2 * globalCount);
  // The scopes keep their numbers. Only the lists of them are in the other order.
  let scopeOrder = null;
  if (tree.dialect === 0) {
    const ofReferences = new Order(referenceCount, index => references[5 * index]);
    scopeOrder = new Order(scopeCount, index => scopeWords[5 * index + 1]);
    orderAsTypeScriptEslint([ofReferences, scopeOrder]);
    if (ofReferences.hasMoved) {
      const { order, place } = ofReferences;
      const copy = references.slice();
      for (let at = 0; at < referenceCount; at++) references.set(copy.subarray(5 * order[at], 5 * order[at] + 5), 5 * at);
      for (let at = 0; at < globals.length; at += 2) globals[at] = place[globals[at]];
    }
  }

  const scopes = [];
  for (let index = 0; index < scopeCount; index++) {
    const kind = scopeWords[5 * index];
    const upper = scopeWords[5 * index + 2];
    const scope = new Scope(
      index,
      scopeTypes[kind & 255],
      nodes[scopeWords[5 * index + 1]],
      upper === NO_INDEX ? null : scopes[upper],
      (kind & 256) !== 0,
    );
    scope.variableScope = scopes[scopeWords[5 * index + 3]] ?? scope;
    scopes.push(scope);
  }
  const listed = scopeOrder?.hasMoved ? Array.from(scopeOrder.order, index => scopes[index]) : scopes;
  for (const scope of listed) scope.upper?.childScopes.push(scope);
  for (let index = scopeCount - 1; index > 0; index--) {
    const scope = scopes[index];
    if (scope.upper.last < scope.last) scope.upper.last = scope.last;
  }

  // By name: `{ setting, comments }` of what `/* global */` comments say.
  const inComments = new Map();
  for (let i = 0; i < commentCount; i++) {
    const [start, end, setting, count] = words(4);
    const starts = words(count);
    inComments.set(text.slice(start, end), {
      setting: ["readonly", "writable", "off"][setting],
      comments: () => Array.from(starts, start => sourceCode.getTokenByRangeStart(start, { includeComments: true })),
    });
  }

  // What each reference resolves to. A class declaration has a second variable for its name, in its own scope, which
  // is what the name means there. These come after all others.
  const resolved = Uint32Array.from({ length: referenceCount }, (_, index) => references[5 * index + 3]);
  const innerClassNames = new Map();
  const variableObjects = new Array(variableCount);
  const classScopes = scopes.filter(it => it.type === "class" && it.block.type === "ClassDeclaration" && it.block.id);
  if (classScopes.length > 0) {
    // By the index of the variable around the class: the scopes of the classes that declare it.
    const outer = new Map();
    const scopeOfName = new Map(classScopes.map(it => [it.block.id, it]));
    for (let variable = 0; variable < variableCount; variable++) {
      for (let at = variables[2 * variable]; at < variables[2 * variable + 2]; at++) {
        if (definitions[2 * at + 1] !== 3) continue;
        const scope = scopeOfName.get(nodes[definitions[2 * at]]);
        if (scope === undefined) continue;
        const inner = variableObjects.length;
        const object = newVariable(scope.block.id.name, scope, inner, IS_TYPE | IS_VALUE);
        object.defs = [newDefinition("ClassName", scope.block.id)];
        object.defs.forEach(forgetParent);
        variableObjects.push(object);
        innerClassNames.set(scope.index, inner);
        outer.set(variable, [...(outer.get(variable) ?? []), scope]);
      }
    }
    for (let index = 0; index < referenceCount; index++) {
      const candidates = outer.get(resolved[index]);
      if (candidates === undefined) continue;
      const from = references[5 * index + 4];
      const scope = candidates.findLast(it => it.index <= from && from <= it.last);
      if (scope !== undefined) resolved[index] = innerClassNames.get(scope.index);
    }
  }

  scopeData = {
    manager: new ScopeManager(listed),
    scopes,
    scopeWords,
    variables,
    variableCount,
    definitions,
    references,
    globals,
    inComments,
    resolved,
    innerClassNames,
    variableObjects,
    referenceObjects: new Array(referenceCount),
    libVariables: new Map(),
    mentionedGlobals: null,
    referencesByScope: memoize(() => group(referenceCount, scopeCount, index => references[5 * index + 4])),
    referencesByVariable: memoize(() => group(referenceCount, variableObjects.length, index => resolved[index])),
    // By the index of a variable: that of its scope.
    variableScopes: memoize(() => {
      const of = new Uint32Array(variableObjects.length);
      for (let scope = 0; scope < scopeCount; scope++) of.fill(scope, scopeWords[5 * scope + 4], scopeWords[5 * scope + 9]);
      for (const [scope, variable] of innerClassNames) of[variable] = scope;
      return of;
    }),
    // By name: the references to a variable that the file does not declare.
    referencesToGlobals: memoize(() => {
      const byName = new Map();
      for (let index = 0; index < referenceCount; index++) {
        if (!(references[5 * index + 1] & TO_GLOBAL)) continue;
        const reference = referenceAt(index);
        const list = byName.get(reference.identifier.name);
        if (list === undefined) byName.set(reference.identifier.name, [reference]);
        else list.push(reference);
      }
      return byName;
    }),
    ranges: null,
    // The indices of the first and the last reference that is in `scope`, or in a scope in it.
    referenceRange(scope) {
      if (this.ranges === null) {
        const ranges = (this.ranges = new Uint32Array(2 * scopeCount));
        for (let i = 0; i < scopeCount; i++) ranges[2 * i] = NO_INDEX;
        for (let index = 0; index < referenceCount; index++) {
          const from = references[5 * index + 4];
          if (ranges[2 * from] === NO_INDEX) ranges[2 * from] = index;
          ranges[2 * from + 1] = index;
        }
        for (let i = scopeCount - 1; i > 0; i--) {
          if (ranges[2 * i] === NO_INDEX) continue;
          const upper = scopes[i].upper.index;
          if (ranges[2 * upper] === NO_INDEX || ranges[2 * upper] > ranges[2 * i]) ranges[2 * upper] = ranges[2 * i];
          if (ranges[2 * upper + 1] < ranges[2 * i + 1]) ranges[2 * upper + 1] = ranges[2 * i + 1];
        }
      }
      const first = this.ranges[2 * scope.index];
      return first === NO_INDEX ? [1, 0] : [first, this.ranges[2 * scope.index + 1]];
    },
  };
  return scopeData.manager;
}
