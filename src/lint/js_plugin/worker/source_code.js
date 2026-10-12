// Portions of this file are copied from ESLint, which is under the MIT License. The notice is in main.js.

// ───────────── ESLint's `SourceCode` ─────────────
//
// The class is in src/jsc/bindings/LintSourceCode.cpp, apart from the methods about scopes. What a `sourceCode` says is about the
// file that is being linted.

// The text of the file, without the byte order mark.
let text = "";

function requireNode(node) {
  if (!node) throw new TypeError("Missing required argument: node.");
}

const scopeCache = new WeakMap();

// `native.sourceCode` takes the methods from its prototype.
class ScopeMethods {
  getScope(currentNode) {
    requireNode(currentNode);
    const cached = scopeCache.get(currentNode);
    if (cached) return cached;
    const manager = scopeManager();
    const inner = currentNode.type !== "Program";
    let found = manager.scopes[0];
    for (let node = currentNode; node; node = node.parent) {
      const scope = manager.acquire(node, inner);
      if (scope) {
        found = scope.type === "function-expression-name" ? scope.childScopes[0] : scope;
        break;
      }
    }
    scopeCache.set(currentNode, found);
    return found;
  }

  getDeclaredVariables(node) {
    return scopeManager().getDeclaredVariables(node);
  }

  isGlobalReference(node) {
    requireNode(node);
    if (node.type !== "Identifier") return false;
    const variable = scopeManager().scopes[0].set.get(node.name);
    if (!variable || variable.defs.length > 0) return false;
    return variable.references.some(({ identifier }) => identifier === node);
  }

  markVariableAsUsed(name, refNode = this.ast) {
    const currentScope = this.getScope(refNode);
    let initialScope = currentScope;
    if (
      currentScope.type === "global" &&
      currentScope.childScopes.length > 0 &&
      currentScope.childScopes[0].block === this.ast
    ) {
      initialScope = currentScope.childScopes[0];
    }
    for (let scope = initialScope; scope; scope = scope.upper) {
      const variable = scope.variables.find(it => it.name === name);
      if (variable) {
        variable.eslintUsed = true;
        return true;
      }
    }
    return false;
  }
}

const SourceCode = native.sourceCode(
  native.TokenStore,
  [program, scopeManager, () => fileSettings.languageOptions.parserOptions, visitorKeys],
  // They are also in src/jsc/bindings/LintSourceCode.cpp, which this turns on.
  process.env.BUN_LINT_NATIVE_SCOPE_METHODS === "1" ? null : ScopeMethods.prototype,
);

// Of the file that is being linted.
let sourceCode = new SourceCode();
