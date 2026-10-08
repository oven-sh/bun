// ───────────── ESLint's `SourceCode` ─────────────
//
// There is one object for all files. What it says is about the file that is being linted, and is
// computed, or asked for, the first time a rule wants it.

// The text of the file, without the byte order mark.
let text = "";
let hasBOM = false;
// Where each line starts. `null`: not computed yet.
let lineStarts = null;
let lines = null;
let inlineConfigNodes = null;
let disableDirectives = null;

const lineBreak = /\r\n|[\r\n\u2028\u2029]/gu;

function computeLineStarts() {
  lineStarts = [0];
  lineBreak.lastIndex = 0;
  while (lineBreak.test(text)) lineStarts.push(lineBreak.lastIndex);
  return lineStarts;
}

// `{ line, column }` of an index in the text, which is not checked.
function locationOf(index) {
  const starts = lineStarts ?? computeLineStarts();
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (index < starts[middle]) high = middle;
    else low = middle + 1;
  }
  return { line: low, column: index - starts[low - 1] };
}

function requireNode(node) {
  if (!node) throw new TypeError("Missing required argument: node.");
}

const scopeCache = new WeakMap();

// What a comment says to ESLint: `{ label, value, justification }`, or undefined if it does not start with a word.
function parseDirective(value) {
  const dashes = /\s-{2,}\s/u.exec(value);
  const directive = (dashes ? value.slice(0, dashes.index) : value).trim();
  const match = /^([a-z]+(?:-[a-z]+)*)(?:\s|$)/u.exec(directive);
  if (!match) return undefined;
  return {
    label: match[1],
    value: directive.slice(match[1].length).trim(),
    justification: dashes ? value.slice(dashes.index + dashes[0].length).trim() : "",
  };
}

const directiveLabel = /^(eslint(?:-env|-enable|-disable(?:(?:-next)?-line)?)?|exported|globals?)(?:\s|$)/u;
const lineDirectiveLabel = /^eslint-disable-(?:next-)?line$/u;

class SourceCode extends TokenStore {
  get text() {
    return text;
  }
  get hasBOM() {
    return hasBOM;
  }
  get ast() {
    return program();
  }
  get lines() {
    return (lines ??= text.split(lineBreak));
  }
  get lineStartIndices() {
    return lineStarts ?? computeLineStarts();
  }
  get tokensAndComments() {
    return tokensAndComments();
  }
  get visitorKeys() {
    return visitorKeys[dialect()];
  }
  get parserServices() {
    return parserServices;
  }
  get scopeManager() {
    return scopeManager();
  }
  get isESTree() {
    return true;
  }

  static splitLines(text) {
    return text.split(lineBreak);
  }

  getText(node, beforeCount, afterCount) {
    if (!node) return text;
    return text.slice(Math.max(node.range[0] - (beforeCount || 0), 0), node.range[1] + (afterCount || 0));
  }

  getLines() {
    return this.lines;
  }

  getAllComments() {
    return comments();
  }

  getInlineConfigNodes() {
    return (inlineConfigNodes ??= comments().filter(comment => {
      if (comment.type === "Shebang") return false;
      const directive = parseDirective(comment.value);
      if (!directive || !directiveLabel.test(directive.label)) return false;
      return comment.type !== "Line" || lineDirectiveLabel.test(directive.label);
    }));
  }

  getDisableDirectives() {
    if (disableDirectives !== null) return disableDirectives;
    const problems = [];
    const directives = [];
    for (const node of this.getInlineConfigNodes()) {
      const { label, value, justification } = parseDirective(node.value);
      if (label === "eslint-disable-line" && node.loc.start.line !== node.loc.end.line) {
        problems.push({ ruleId: null, message: `${label} comment should not span multiple lines.`, loc: node.loc });
      } else if (/^eslint-(?:enable|disable(?:(?:-next)?-line)?)$/u.test(label)) {
        directives.push({ type: label.slice("eslint-".length), node, value, justification });
      }
    }
    return (disableDirectives = { problems, directives });
  }

  getNodeByRangeIndex(index) {
    program();
    const { starts, ends, count } = tree;
    let result = null;
    for (let id = 0; id < count; ) {
      if (starts[id] <= index && index < ends[id]) result = nodes[id++];
      else id = lastDescendants()[id] + 1;
    }
    return result;
  }

  getLocFromIndex(index) {
    if (typeof index !== "number") throw new TypeError("Expected `index` to be a number.");
    if (index < 0 || index > text.length) {
      throw new RangeError(
        `Index out of range (requested index ${index}, but source text has length ${text.length}).`,
      );
    }
    return locationOf(index);
  }

  getIndexFromLoc(loc) {
    if (loc === null || typeof loc !== "object" || typeof loc.line !== "number" || typeof loc.column !== "number") {
      throw new TypeError("Expected `loc` to be an object with numeric `line` and `column` properties.");
    }
    const starts = this.lineStartIndices;
    if (loc.line <= 0) {
      throw new RangeError(
        `Line number out of range (line ${loc.line} requested). Line numbers should be 1-based.`,
      );
    }
    if (loc.line > starts.length) {
      throw new RangeError(
        `Line number out of range (line ${loc.line} requested, but only ${starts.length} lines present).`,
      );
    }
    if (loc.column < 0) throw new RangeError(`Invalid column number (column ${loc.column} requested).`);
    const isLast = loc.line === starts.length;
    const start = starts[loc.line - 1];
    const end = isLast ? text.length : starts[loc.line];
    const index = start + loc.column;
    if (isLast ? index > end : index >= end) {
      throw new RangeError(
        `Column number out of range (column ${loc.column} requested, but the length of line ${loc.line} is ${end - start}).`,
      );
    }
    return index;
  }

  getLoc(nodeOrToken) {
    return nodeOrToken.loc;
  }

  getRange(nodeOrToken) {
    return nodeOrToken.range;
  }

  getParent(node) {
    return node.parent;
  }

  getAncestors(node) {
    requireNode(node);
    const ancestors = [];
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) ancestors.push(ancestor);
    return ancestors.reverse();
  }

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

const sourceCode = new SourceCode();
const parserServices = Object.freeze({});
