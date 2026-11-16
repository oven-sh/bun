// XPath 1.0. An expression is compiled to closures.
const resultTypes = { number: 1, string: 2, boolean: 3, object: 4 };

const core = require("internal/desktop/dom/core");
const nodes = require("internal/desktop/dom/node");

const { ATTRIBUTE, COMMENT, DOCTYPE, ELEMENT, INSTRUCTION, domError, expose, wrapOrNull } = core;

type N = $Dom.N;
type Value = N[] | string | number | boolean;
type Context = { node: N; position: number; size: number };
type Expression = (context: Context) => Value;
type Token = { kind: "name" | "number" | "string" | "operator" | "symbol"; text: string };

const MAX_EXPRESSION_DEPTH = 200;
const nameStart =
  "A-Z_a-z\\xC0-\\xD6\\xD8-\\xF6\\xF8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const name = `[${nameStart}][${nameStart}\\-.0-9\\xB7\\u0300-\\u036F\\u203F\\u2040]*`;
const lexer = new RegExp(
  `[ \\t\\r\\n]*(?:(\\d+(?:\\.\\d*)?|\\.\\d+)|"([^"]*)"|'([^']*)'|(${name}(?::(?:${name}|\\*))?)|(::|//|\\.\\.|!=|<=|>=|[()\\[\\].@,/|+\\-=<>*$])|$)`,
  "uy",
);
const spaces = /[ \t\r\n]+/;

const syntaxError = (source: string) =>
  domError("SyntaxError", `The string '${source}' is not a valid XPath expression.`);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  lexer.lastIndex = 0;
  while (true) {
    const match = lexer.exec(source);
    if (match === null) throw syntaxError(source);
    const [, number, double, single, word, symbol] = match;
    const last = tokens.at(-1);
    const followsOperand =
      last !== undefined && last.kind !== "operator" && !(last.kind === "symbol" && "@::([,".includes(last.text));
    if (number !== undefined) tokens.push({ kind: "number", text: number });
    else if ((double ?? single) !== undefined) tokens.push({ kind: "string", text: double ?? single });
    else if (word !== undefined) tokens.push({ kind: followsOperand ? "operator" : "name", text: word });
    else if (symbol === undefined) return tokens;
    else if (symbol === "*") tokens.push({ kind: followsOperand ? "operator" : "name", text: symbol });
    else tokens.push({ kind: "// | + - != <= >=".includes(symbol) ? "operator" : "symbol", text: symbol });
  }
}

const parentOf = (node: N): N | null => (node.type === ATTRIBUTE ? node.x.element : node.parent);
const namespaceOf = (node: N): string =>
  (node.type === ATTRIBUTE ? node.x.namespace : node.type === ELEMENT && core.namespaceOf(node)) || "";
const hasName = (node: N) => node.type === ELEMENT || node.type === ATTRIBUTE || node.type === INSTRUCTION;

function stringValue(node: N): string {
  if (node.type === ATTRIBUTE) return core.hooks.attrValue(node);
  return core.isData(node) ? node.data : node.type === DOCTYPE ? "" : core.textContent(node);
}

function toText(value: Value): string {
  if ($isArray(value)) return value.length === 0 ? "" : stringValue(value[0]);
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return `${value}`;
  const [digits, exponent] = Math.abs(value).toExponential().replace(".", "").split("e");
  const point = +exponent + 1;
  const sign = value < 0 ? "-" : "";
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  return (
    sign + (point >= digits.length ? digits.padEnd(point, "0") : digits.slice(0, point) + "." + digits.slice(point))
  );
}

function toNumber(value: Value): number {
  if (typeof value === "number" || typeof value === "boolean") return +value;
  const match = /^[ \t\r\n]*(-?(?:\d+(?:\.\d*)?|\.\d+))[ \t\r\n]*$/.exec(toText(value));
  return match === null ? NaN : +match[1];
}

function toBoolean(value: Value): boolean {
  return $isArray(value) ? value.length > 0 : !!value;
}

function toNodes(value: Value): N[] {
  if (!$isArray(value)) throw new TypeError("The expression does not evaluate to a node set.");
  return value as N[];
}

function compareOrder(a: N, b: N): number {
  const [x, y] = [a.type === ATTRIBUTE ? (a.x.element ?? a) : a, b.type === ATTRIBUTE ? (b.x.element ?? b) : b];
  if (x !== y) return core.compareOrder(x, y);
  const rank = (node: N) => (node === x ? -1 : core.attrIndex(x, nodes.keyOf(node)));
  return rank(a) - rank(b);
}

const inOrder = (list: N[]) => Array.from(new Set(list)).sort(compareOrder);

function collect(first: N | null, next: (node: N) => N | null): N[] {
  const found: N[] = [];
  for (let node = first; node !== null; node = next(node)) found.push(node);
  return found;
}

const descendants = (node: N) => collect(node.first, it => core.following(it, node));
/** In the order of the axis. */
const axes: Record<string, (node: N) => N[]> = {
  __proto__: null as any,
  "ancestor": node => collect(parentOf(node), parentOf),
  "ancestor-or-self": node => collect(node, parentOf),
  "attribute": node =>
    node.type !== ELEMENT
      ? []
      : nodes
          .attributeKeys(node)
          .filter(it => core.attrNamespace(it) !== core.XMLNS_NS)
          .map(it => nodes.attrNode(node, it)!),
  "child": node => collect(node.first, it => it.next),
  "descendant": descendants,
  "descendant-or-self": node => [node, ...descendants(node)],
  "following": node =>
    collect(
      node.type === ATTRIBUTE ? node.x.element && core.following(node.x.element, null) : core.followingSkip(node, null),
      it => core.following(it, null),
    ),
  "following-sibling": node => collect(node.next, it => it.next),
  "namespace": () => [],
  "parent": node => collect(parentOf(node), () => null),
  "preceding"(node) {
    const from = node.type === ATTRIBUTE ? (node.x.element ?? node) : node;
    return collect(from, it => core.preceding(it, null)).filter(it => !core.contains(it, from));
  },
  "preceding-sibling": node => collect(node.prev, it => it.prev),
  "self": node => [node],
};

const comparisons: Record<string, (a: any, b: any) => boolean> = {
  "=": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
};

function compare(operator: string, a: Value, b: Value): boolean {
  if ($isArray(a) && typeof b !== "boolean") return a.some(node => compare(operator, stringValue(node), b));
  if ($isArray(b) && typeof a !== "boolean") return b.some(node => compare(operator, a, stringValue(node)));
  const hasBoolean = typeof a === "boolean" || typeof b === "boolean";
  const isEquality = operator === "=" || operator === "!=";
  if (hasBoolean && (isEquality || $isArray(a) || $isArray(b))) [a, b] = [toBoolean(a), toBoolean(b)];
  if (!isEquality || typeof a === "number" || typeof b === "number") [a, b] = [toNumber(a), toNumber(b)];
  return comparisons[operator](a, b);
}

const arithmetic: Record<string, (a: number, b: number) => number> = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "div": (a, b) => a / b,
  "mod": (a, b) => a % b,
};
const precedence = [["or"], ["and"], ["=", "!="], ["<", "<=", ">", ">="], ["+", "-"], ["*", "div", "mod"]];

const first = (context: Context, value?: Value): N | undefined =>
  value === undefined ? context.node : toNodes(value)[0];
const orSelf = (context: Context, value?: Value) => value ?? [context.node];
const named = (read: (node: N) => string) => (context: Context, value?: Value) => {
  const node = first(context, value);
  return node !== undefined && hasName(node) ? read(node) : "";
};

/** The least and the most arguments. */
const functions: Record<string, [number, number, (context: Context, ...values: any[]) => Value]> = {
  __proto__: null as any,
  "boolean": [1, 1, (_, a) => toBoolean(a)],
  "ceiling": [1, 1, (_, a) => Math.ceil(toNumber(a))],
  "concat": [2, Infinity, (_, ...all) => all.map(toText).join("")],
  "contains": [2, 2, (_, a, b) => toText(a).includes(toText(b))],
  "count": [1, 1, (_, a) => toNodes(a).length],
  "false": [0, 0, () => false],
  "floor": [1, 1, (_, a) => Math.floor(toNumber(a))],
  "id": [
    1,
    1,
    ({ node }, a) => {
      const root = core.rootOf(parentOf(node) ?? node);
      const ids = ($isArray(a) ? a.map(stringValue).join(" ") : toText(a)).split(spaces);
      return inOrder(ids.map(id => core.elementById(root, id)!).filter(Boolean));
    },
  ],
  "lang": [
    1,
    1,
    ({ node }, a) => {
      const holder = axes["ancestor-or-self"](node).find(it => core.findAttrNS(it, core.XML_NS, "lang") !== null);
      if (holder === undefined) return false;
      const value = core.asciiLower(core.getAttrNS(holder, core.XML_NS, "lang")!);
      const wanted = core.asciiLower(toText(a));
      return value === wanted || value.startsWith(wanted + "-");
    },
  ],
  "last": [0, 0, context => context.size],
  "local-name": [0, 1, named(node => node.name)],
  "name": [0, 1, named(core.qualifiedName)],
  "namespace-uri": [0, 1, named(namespaceOf)],
  "normalize-space": [0, 1, (context, a) => toText(orSelf(context, a)).split(spaces).filter(Boolean).join(" ")],
  "not": [1, 1, (_, a) => !toBoolean(a)],
  "number": [0, 1, (context, a) => toNumber(orSelf(context, a))],
  "position": [0, 0, context => context.position],
  "round": [1, 1, (_, a) => Math.round(toNumber(a))],
  "starts-with": [2, 2, (_, a, b) => toText(a).startsWith(toText(b))],
  "string": [0, 1, (context, a) => toText(orSelf(context, a))],
  "string-length": [0, 1, (context, a) => toText(orSelf(context, a)).length],
  "substring": [
    2,
    3,
    (_, a, b, c) => {
      const start = Math.round(toNumber(b));
      const end = c === undefined ? Infinity : start + Math.round(toNumber(c));
      return start < end ? toText(a).slice(Math.max(start - 1, 0), Math.max(end - 1, 0)) : "";
    },
  ],
  "substring-after": [
    2,
    2,
    (_, a, b) => {
      const index = (a = toText(a)).indexOf((b = toText(b)));
      return index < 0 ? "" : a.slice(index + b.length);
    },
  ],
  "substring-before": [2, 2, (_, a, b) => (a = toText(a)).slice(0, Math.max(a.indexOf(toText(b)), 0))],
  "sum": [1, 1, (_, a) => toNodes(a).reduce((sum, node) => sum + toNumber(stringValue(node)), 0)],
  "translate": [
    3,
    3,
    (_, a, b, c) => {
      const [from, to] = [toText(b), toText(c)];
      return toText(a).replace(/[^]/g, it => (from.includes(it) ? (to[from.indexOf(it)] ?? "") : it));
    },
  ],
  "true": [0, 0, () => true],
};

const kindTests: Record<string, (node: N) => boolean> = {
  __proto__: null as any,
  "comment": node => node.type === COMMENT,
  "node": () => true,
  "processing-instruction": node => node.type === INSTRUCTION,
  "text": core.isText,
};

function filter(list: N[], predicates: Expression[]): N[] {
  for (const predicate of predicates) {
    const size = list.length;
    list = list.filter((node, index) => {
      const value = predicate({ node, position: index + 1, size });
      return typeof value === "number" ? value === index + 1 : toBoolean(value);
    });
  }
  return list;
}

function compile(source: string, resolver: any): Expression {
  const tokens = tokenize(source);
  let at = 0;
  let depth = 0;
  const is = (text: string, offset = 0) => tokens[at + offset]?.text === text && tokens[at + offset].kind !== "string";
  const take = (text: string) => is(text) && ++at > 0;
  const fail = (): never => {
    throw syntaxError(source);
  };
  const expect = (text: string) => take(text) || fail();

  function binary(level: number): Expression {
    if (level === precedence.length) return unary();
    let left = binary(level + 1);
    for (let chain = 0; tokens[at]?.kind === "operator" && precedence[level].includes(tokens[at].text); chain++) {
      if (chain > 5000) fail();
      const [operator, a, b] = [tokens[at++].text, left, binary(level + 1)];
      if (level === 0) left = context => toBoolean(a(context)) || toBoolean(b(context));
      else if (level === 1) left = context => toBoolean(a(context)) && toBoolean(b(context));
      else if (level < 4) left = context => compare(operator, a(context), b(context));
      else left = context => arithmetic[operator](toNumber(a(context)), toNumber(b(context)));
    }
    return left;
  }

  function expression(): Expression {
    if (++depth > MAX_EXPRESSION_DEPTH) fail();
    const parsed = binary(0);
    depth--;
    return parsed;
  }

  function unary(): Expression {
    let signs = 0;
    while (take("-")) signs++;
    const parts = [path()];
    while (take("|")) parts.push(path());
    const union: Expression =
      parts.length === 1 ? parts[0] : context => inOrder(parts.flatMap(it => toNodes(it(context))));
    return signs === 0 ? union : context => (signs % 2 ? -1 : 1) * toNumber(union(context));
  }

  function predicates(): Expression[] {
    const all: Expression[] = [];
    while (take("[")) {
      all.push(expression());
      expect("]");
    }
    return all;
  }

  function lookUp(prefix: string): string {
    if (resolver !== null) {
      let namespace;
      try {
        namespace = $isCallable(resolver) ? resolver.$call(undefined, prefix) : resolver.lookupNamespaceURI(prefix);
        if (namespace != null) return `${namespace}`;
      } catch (error) {
        core.reportError(null, error);
      }
    }
    throw domError("NamespaceError", `The string '${source}' contains unresolvable namespaces.`);
  }

  function nameTest(text: string, axis: string): (node: N) => boolean {
    const type = axis === "attribute" ? ATTRIBUTE : ELEMENT;
    const colon = text.indexOf(":");
    if (text === "*") return node => node.type === type;
    if (colon >= 0) {
      const [namespace, local] = [lookUp(text.slice(0, colon)), text.slice(colon + 1)];
      return node => node.type === type && namespaceOf(node) === namespace && (local === "*" || node.name === local);
    }
    const lower = core.asciiLower(text);
    return node => {
      if (node.type !== type) return false;
      const element: N = type === ATTRIBUTE ? node.x.element : node;
      if (node.doc.isHtml && element.ns === core.HTML) {
        return core.asciiLower(node.name) === lower && (type === ELEMENT || namespaceOf(node) === "");
      }
      return node.name === text && namespaceOf(node) === "" && (type === ATTRIBUTE || !node.doc.isHtml);
    };
  }

  function step(): (node: N) => N[] {
    if (take(".")) return axes.self;
    if (take("..")) return axes.parent;
    let axis = "child";
    if (take("@")) axis = "attribute";
    else if (is("::", 1)) {
      axis = tokens[at].text;
      at += 2;
    }
    const walk = axes[axis] ?? fail();
    const token = tokens[at++];
    if (token?.kind !== "name") fail();
    let test: (node: N) => boolean;
    if (take("(")) {
      test = kindTests[token.text] ?? fail();
      if (token.text === "processing-instruction" && tokens[at]?.kind === "string") {
        const target = tokens[at++].text;
        test = node => node.type === INSTRUCTION && node.name === target;
      }
      expect(")");
    } else test = nameTest(token.text, axis);
    const conditions = predicates();
    return node => filter(walk(node).filter(test), conditions);
  }

  function primary(): Expression {
    const token = tokens[at++];
    if (token.kind === "string") return () => token.text;
    if (token.kind === "number") return () => +token.text;
    if (token.text === "$") fail();
    if (token.text === "(") {
      const inner = expression();
      expect(")");
      return inner;
    }
    const [least, most, run] = functions[token.text] ?? fail();
    const parameters: Expression[] = [];
    expect("(");
    if (!take(")")) {
      do parameters.push(expression());
      while (take(","));
      expect(")");
    }
    if (parameters.length < least || parameters.length > most) fail();
    return context => run(context, ...parameters.map(it => it(context)));
  }

  function path(): Expression {
    const token = tokens[at] ?? fail();
    const steps: ((node: N) => N[])[] = [];
    let start: Expression = context => [context.node];
    const isCall = token.kind === "name" && is("(", 1) && !(token.text in kindTests);
    if (isCall || token.kind === "string" || token.kind === "number" || is("(") || is("$")) {
      const [value, conditions] = [primary(), predicates()];
      start = conditions.length === 0 ? value : context => filter(toNodes(value(context)), conditions);
      if (!is("/") && !is("//")) return start;
    } else if (is("/") || is("//")) {
      start = ({ node }) => [core.rootOf(parentOf(node) ?? node)];
      const next = tokens[at + 1];
      if (is("/") && next?.kind !== "name" && !is("*", 1) && !is(".", 1) && !is("..", 1) && !is("@", 1)) {
        at++;
        return start;
      }
    } else steps.push(step());
    while (is("/") || is("//")) {
      if (tokens[at++].text === "//") steps.push(axes["descendant-or-self"]);
      steps.push(step());
    }
    return context => steps.reduce((list, next) => inOrder(list.flatMap(it => next(it))), toNodes(start(context)));
  }

  const compiled = expression();
  if (at < tokens.length) fail();
  return compiled;
}

const internal = Symbol();
const wrongType = (what: string) => new TypeError(`The result type is not ${what}.`);

class XPathResult {
  #type: number;
  #value: any;
  #doc: $Dom.Doc;
  #version: number;
  #index = 0;

  constructor(key?: symbol, value?: Value, type?: number, doc?: $Dom.Doc) {
    if (key !== internal) core.illegalConstructor();
    if (type! > 9) throw domError("NotSupportedError", "The result type is not supported.");
    type ||= resultTypes[typeof value as string];
    this.#type = type!;
    this.#value = ([toNumber, toText, toBoolean][type! - 1] ?? toNodes)(value!);
    this.#doc = doc!;
    this.#version = doc!.version + doc!.attributeVersion;
  }
  get resultType() {
    return this.#type;
  }
  get numberValue() {
    if (this.#type !== 1) throw wrongType("a number");
    return this.#value;
  }
  get stringValue() {
    if (this.#type !== 2) throw wrongType("a string");
    return this.#value;
  }
  get booleanValue() {
    if (this.#type !== 3) throw wrongType("a boolean");
    return this.#value;
  }
  get singleNodeValue() {
    if (this.#type < 8) throw wrongType("a single node");
    return wrapOrNull(this.#value[0]);
  }
  get invalidIteratorState() {
    return (this.#type === 4 || this.#type === 5) && this.#version !== this.#doc.version + this.#doc.attributeVersion;
  }
  get snapshotLength() {
    if (this.#type !== 6 && this.#type !== 7) throw wrongType("a snapshot");
    return this.#value.length;
  }
  iterateNext() {
    if (this.#type !== 4 && this.#type !== 5) throw wrongType("an iterator");
    if (this.invalidIteratorState)
      throw domError("InvalidStateError", "The document has mutated since the result was returned.");
    return wrapOrNull(this.#value[this.#index++]);
  }
  snapshotItem(index: number) {
    if (this.#type !== 6 && this.#type !== 7) throw wrongType("a snapshot");
    if ($argumentCount() < 1) core.tooFew(1);
    return wrapOrNull(this.#value[index >>> 0]);
  }
}
const types = core.splitTokens(`ANY NUMBER STRING BOOLEAN UNORDERED_NODE_ITERATOR ORDERED_NODE_ITERATOR
  UNORDERED_NODE_SNAPSHOT ORDERED_NODE_SNAPSHOT ANY_UNORDERED_NODE FIRST_ORDERED_NODE`);
expose(XPathResult, Object.fromEntries(types.map((it, index) => [it + "_TYPE", index])));

class XPathExpression {
  #compiled: Expression;

  constructor(key?: symbol, compiled?: Expression) {
    if (key !== internal) core.illegalConstructor();
    this.#compiled = compiled!;
  }
  evaluate(contextNode: object, type = 0, _result = null) {
    const node = core.unwrap(contextNode, "evaluate");
    if (node.type === DOCTYPE || node.type === core.FRAGMENT) {
      throw domError("NotSupportedError", "The node is not a valid context node.");
    }
    return new XPathResult(internal, this.#compiled({ node, position: 1, size: 1 }), type & 0xffff, node.doc);
  }
}
expose(XPathExpression);

const evaluator = {
  createExpression(expression: string, resolver: any = null) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (resolver !== null && !$isObject(resolver)) throw new TypeError("The resolver is not an object.");
    return new XPathExpression(internal, compile(`${expression}`, resolver));
  },
  createNSResolver(nodeResolver: object) {
    core.unwrap(nodeResolver, "createNSResolver");
    return nodeResolver;
  },
  evaluate(expression: string, contextNode: object, resolver: any = null, type = 0, _result = null) {
    core.unwrap(contextNode, "evaluate", 2);
    return evaluator.createExpression(expression, resolver).evaluate(contextNode, type);
  },
};

class XPathEvaluator {}
core.mixin(evaluator, XPathEvaluator);
expose(XPathEvaluator);

export default { evaluator };
