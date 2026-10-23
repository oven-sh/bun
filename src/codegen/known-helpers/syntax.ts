import { readdirSync } from "node:fs";
import path from "node:path";

export interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: any;
}

type Parse = (text: string, options: object) => Node;

let parse: Parse | undefined;

export async function loadParser(packages: string): Promise<void> {
  const folder = readdirSync(packages).find(name => name.startsWith("@babel+parser@"));
  if (folder === undefined) throw new Error(`${packages} has no @babel/parser: run --fetch first`);
  const loaded = await import(path.resolve(packages, folder, "lib/index.js"));
  parse = loaded.parse ?? loaded.default.parse;
}

export function parseProgram(text: string): Node | undefined {
  if (parse === undefined) throw new Error("loadParser() comes first");
  try {
    const file = parse(text, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      allowUndeclaredExports: true,
      plugins: ["decorators"],
    });
    return file.program;
  } catch {
    return undefined;
  }
}

export function isFunction(node: Node): boolean {
  return (
    node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" || node.type === "FunctionDeclaration"
  );
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).type === "string";
}

function forEachChild(node: Node, visit: (child: Node) => void): void {
  for (const key in node) {
    if (key === "loc" || key === "extra" || key.endsWith("Comments")) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) visit(item);
    } else if (isNode(value)) visit(value);
  }
}

export function forEachPatternName(pattern: Node | null, declare: (name: string) => void): void {
  if (pattern === null) return;
  switch (pattern.type) {
    case "Identifier":
      declare(pattern.name);
      break;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        forEachPatternName(property.type === "RestElement" ? property.argument : property.value, declare);
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) forEachPatternName(element, declare);
      break;
    case "AssignmentPattern":
      forEachPatternName(pattern.left, declare);
      break;
    case "RestElement":
      forEachPatternName(pattern.argument, declare);
      break;
  }
}

function forEachHoistedVariable(node: Node, declare: (name: string) => void): void {
  if (isFunction(node) || node.type === "ObjectMethod" || node.type.startsWith("Class")) return;
  if (node.type === "VariableDeclaration" && node.kind === "var") {
    for (const declarator of node.declarations) forEachPatternName(declarator.id, declare);
  }
  forEachChild(node, child => forEachHoistedVariable(child, declare));
}

function forEachBlockDeclaration(statements: readonly Node[], declare: (name: string) => void): void {
  for (const statement of statements) {
    if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
      for (const declarator of statement.declarations) forEachPatternName(declarator.id, declare);
    } else if ((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id) {
      declare(statement.id.name);
    }
  }
}

function declaresInItsBlock(statement: Node): boolean {
  switch (statement.type) {
    case "VariableDeclaration":
      return statement.kind !== "var";
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return true;
    case "LabeledStatement":
      return declaresInItsBlock(statement.body);
    default:
      return false;
  }
}

function canonicalStatement(statement: Node): Node {
  let current = statement;
  while (
    current.type === "BlockStatement" &&
    current.body.length === 1 &&
    !current.directives?.length &&
    !declaresInItsBlock(current.body[0])
  ) {
    current = current.body[0];
  }
  return current;
}

function canonicalBody(node: Node): Node {
  const body: Node = node.body;
  if (
    node.type !== "ArrowFunctionExpression" ||
    body.type !== "BlockStatement" ||
    body.body.length !== 1 ||
    body.directives?.length
  )
    return body;
  const only = canonicalStatement(body.body[0]);
  return only.type === "ReturnStatement" && only.argument ? only.argument : body;
}

function comparesTypeName(left: Node, right: Node): boolean {
  const isTypeof = (node: Node) => node.type === "UnaryExpression" && node.operator === "typeof";
  return (isTypeof(left) && right.type === "StringLiteral") || (left.type === "StringLiteral" && isTypeof(right));
}

export interface CanonicalFunction {
  readonly tree: string;
  readonly outerNames: readonly string[];
  readonly globalNames: readonly string[];
  readonly unsupported: string | undefined;
}

class Writer {
  readonly out: string[] = [];
  readonly outerNames: string[] = [];
  readonly globalNames: string[] = [];
  unsupported: string | undefined;
  private scopes: Map<string, number>[] = [];
  private labels: string[] = [];
  private symbolCount = 0;
  private readonly localIndexes = new Map<number, number>();

  constructor(
    private readonly root: Node,
    private readonly isOuterName: (name: string) => boolean,
  ) {}

  private refuse(what: string): void {
    this.unsupported ??= what;
  }

  private openScope(): (name: string) => void {
    const scope = new Map<string, number>();
    this.scopes.push(scope);
    return name => {
      if (!scope.has(name)) scope.set(name, this.symbolCount++);
    };
  }

  private closeScope(): void {
    this.scopes.pop();
  }

  private identifier(name: string): void {
    for (let depth = this.scopes.length - 1; depth >= 0; depth--) {
      const symbol = this.scopes[depth].get(name);
      if (symbol === undefined) continue;
      let index = this.localIndexes.get(symbol);
      if (index === undefined) {
        index = this.localIndexes.size;
        this.localIndexes.set(symbol, index);
      }
      this.out.push(`L${index}`);
      return;
    }
    if (this.isOuterName(name)) {
      let index = this.outerNames.indexOf(name);
      if (index < 0) index = this.outerNames.push(name) - 1;
      this.out.push(`O${index}`);
      return;
    }
    if (name === "undefined") {
      this.out.push("U");
      return;
    }
    if (!this.globalNames.includes(name)) this.globalNames.push(name);
    this.out.push(`G:${name}`);
  }

  private text(text: string): void {
    this.out.push(JSON.stringify(text));
  }

  function(node: Node): void {
    const kinds: Record<string, number> = { method: 2, get: 3, set: 4 };
    const kind = node.type === "ArrowFunctionExpression" ? 1 : node.type === "ObjectMethod" ? kinds[node.kind] : 0;
    this.out.push("F", String(kind), node.async ? "a" : "-", node.generator ? "g" : "-");
    const hasOwnName = kind === 0 && Boolean(node.id);
    const opensNameScope = hasOwnName && (node.type === "FunctionExpression" || node === this.root);
    if (opensNameScope) this.openScope()(node.id.name);
    if (node !== this.root) {
      this.out.push(hasOwnName ? "n" : "-");
      if (hasOwnName) this.identifier(node.id.name);
    }
    const declare = this.openScope();
    for (const parameter of node.params) forEachPatternName(parameter, declare);
    if (node.body.type === "BlockStatement") {
      forEachHoistedVariable(node.body, declare);
      forEachBlockDeclaration(node.body.body, declare);
    }
    this.out.push(String(node.params.length));
    for (const parameter of node.params) {
      const isRest = parameter.type === "RestElement";
      const hasDefault = parameter.type === "AssignmentPattern";
      this.out.push(isRest ? "r" : "-");
      this.pattern(isRest ? parameter.argument : hasDefault ? parameter.left : parameter);
      this.optionalExpression(hasDefault ? parameter.right : null);
    }
    const openLabels = this.labels;
    this.labels = [];
    const body = canonicalBody(node);
    if (body.type === "BlockStatement") {
      this.out.push("b");
      this.statements(body.directives ?? [], body.body);
    } else {
      this.out.push("e");
      this.expression(body);
    }
    this.labels = openLabels;
    this.closeScope();
    if (opensNameScope) this.closeScope();
  }

  private statements(directives: readonly Node[], statements: readonly Node[]): void {
    this.out.push(String(directives.length + statements.length));
    for (const directive of directives) {
      this.out.push("S19");
      this.text(directive.value.extra?.raw ?? directive.value.value);
    }
    for (const statement of statements) this.statement(statement);
  }

  private block(directives: readonly Node[], statements: readonly Node[]): void {
    forEachBlockDeclaration(statements, this.openScope());
    this.statements(directives, statements);
    this.closeScope();
  }

  private propertyKey(property: Node): void {
    const key: Node = property.key;
    const isLiteral = key.type === "StringLiteral" || key.type === "NumericLiteral";
    if (key.type === "PrivateName") this.refuse("a private name");
    else if (isLiteral) this.out.push("k", JSON.stringify(String(key.value)));
    else if (!property.computed && key.type === "Identifier") this.out.push("k", JSON.stringify(key.name));
    else {
      this.out.push("c");
      this.expression(key);
    }
  }

  private pattern(pattern: Node | null): void {
    if (pattern === null) {
      this.out.push("P0");
      return;
    }
    switch (pattern.type) {
      case "Identifier":
        this.out.push("P1");
        this.identifier(pattern.name);
        break;
      case "ObjectPattern":
        this.out.push("P2", String(pattern.properties.length));
        for (const property of pattern.properties) {
          if (property.type === "RestElement") {
            this.out.push("r", "-");
            this.pattern(property.argument);
            this.optionalExpression(null);
            continue;
          }
          this.out.push("-");
          this.propertyKey(property);
          const hasDefault = property.value.type === "AssignmentPattern";
          this.pattern(hasDefault ? property.value.left : property.value);
          this.optionalExpression(hasDefault ? property.value.right : null);
        }
        break;
      case "ArrayPattern":
        this.out.push("P3", String(pattern.elements.length));
        for (const element of pattern.elements) {
          const isRest = element?.type === "RestElement";
          const hasDefault = element?.type === "AssignmentPattern";
          this.out.push(isRest ? "r" : "-");
          this.pattern(isRest ? element.argument : hasDefault ? element.left : element);
          this.optionalExpression(hasDefault ? element.right : null);
        }
        break;
      default:
        this.refuse(`the pattern ${pattern.type}`);
    }
  }

  private declarations(node: Node): void {
    this.out.push("S3", String(node.declarations.length));
    for (const declarator of node.declarations) {
      this.out.push("D", node.kind);
      this.pattern(declarator.id);
      this.optionalExpression(declarator.init);
    }
  }

  private optionalStatement(statement: Node | null | undefined): void {
    if (statement) this.statement(statement);
    else this.out.push("_");
  }

  private optionalExpression(expression: Node | null | undefined): void {
    if (expression) this.expression(expression);
    else this.out.push("_");
  }

  private loopHead(head: Node | null | undefined): void {
    if (!head) this.out.push("_");
    else if (head.type === "VariableDeclaration") this.declarations(head);
    else {
      this.out.push("S2");
      this.target(head);
    }
  }

  private openLoopScope(head: Node | null | undefined): void {
    forEachBlockDeclaration(head ? [head] : [], this.openScope());
  }

  private label(label: Node | null | undefined): void {
    if (!label) {
      this.out.push("_");
      return;
    }
    const depth = this.labels.lastIndexOf(label.name);
    if (depth < 0) this.refuse("a label that is not open");
    this.out.push(String(depth));
  }

  private statement(written: Node): void {
    const node = canonicalStatement(written);
    switch (node.type) {
      case "EmptyStatement":
        this.out.push("S0");
        break;
      case "DebuggerStatement":
        this.out.push("S1");
        break;
      case "ExpressionStatement":
        this.out.push("S2");
        this.expression(node.expression);
        break;
      case "VariableDeclaration":
        this.declarations(node);
        break;
      case "FunctionDeclaration":
        this.out.push("S4");
        this.function(node);
        break;
      case "ReturnStatement":
        this.out.push("S5");
        this.optionalExpression(node.argument);
        break;
      case "IfStatement":
        this.out.push("S6");
        this.expression(node.test);
        this.statement(node.consequent);
        this.optionalStatement(node.alternate);
        break;
      case "ForStatement":
        this.out.push("S7");
        this.openLoopScope(node.init);
        this.loopHead(node.init);
        this.optionalExpression(node.test);
        this.optionalExpression(node.update);
        this.statement(node.body);
        this.closeScope();
        break;
      case "ForInStatement":
      case "ForOfStatement":
        this.out.push(node.type === "ForInStatement" ? "S8" : node.await ? "S9a" : "S9");
        this.openLoopScope(node.left);
        this.loopHead(node.left);
        this.expression(node.right);
        this.statement(node.body);
        this.closeScope();
        break;
      case "WhileStatement":
        this.out.push("S10");
        this.expression(node.test);
        this.statement(node.body);
        break;
      case "DoWhileStatement":
        this.out.push("S11");
        this.statement(node.body);
        this.expression(node.test);
        break;
      case "BlockStatement":
        if (node.body.length === 0 && !node.directives?.length) {
          this.out.push("S0");
          break;
        }
        this.out.push("S12");
        this.block(node.directives ?? [], node.body);
        break;
      case "SwitchStatement":
        this.out.push("S13");
        this.expression(node.discriminant);
        forEachBlockDeclaration(
          node.cases.flatMap((clause: Node) => clause.consequent),
          this.openScope(),
        );
        this.out.push(String(node.cases.length));
        for (const clause of node.cases) {
          this.out.push("C");
          this.optionalExpression(clause.test);
          this.statements([], clause.consequent);
        }
        this.closeScope();
        break;
      case "TryStatement":
        this.out.push("S14");
        this.statement(node.block);
        if (node.handler) {
          const declare = this.openScope();
          forEachPatternName(node.handler.param ?? null, declare);
          if (node.handler.param) {
            this.out.push("D", "catch");
            this.pattern(node.handler.param);
          } else this.out.push("_");
          this.statement(node.handler.body);
          this.closeScope();
        } else this.out.push("_", "_");
        this.optionalStatement(node.finalizer);
        break;
      case "ThrowStatement":
        this.out.push("S15");
        this.expression(node.argument);
        break;
      case "BreakStatement":
        this.out.push("S16");
        this.label(node.label);
        break;
      case "ContinueStatement":
        this.out.push("S17");
        this.label(node.label);
        break;
      case "LabeledStatement":
        this.out.push("S18");
        this.labels.push(node.label.name);
        this.statement(node.body);
        this.labels.pop();
        break;
      default:
        this.refuse(`the statement ${node.type}`);
    }
  }

  private chain(node: Node): void {
    const isInChain = node.type.startsWith("Optional");
    this.out.push(!isInChain ? "-" : node.optional ? "?" : "~");
  }

  private expressions(expressions: readonly (Node | null)[]): void {
    this.out.push(String(expressions.length));
    for (const expression of expressions) {
      if (expression === null) this.out.push("(E0)");
      else this.expression(expression);
    }
  }

  private target(node: Node): void {
    switch (node.type) {
      case "ObjectPattern":
        this.out.push("(E12", String(node.properties.length));
        for (const property of node.properties) {
          if (property.type === "RestElement") {
            this.out.push("K1", "-");
            this.target(property.argument);
            continue;
          }
          this.out.push("K0");
          this.propertyKey(property);
          this.target(property.value);
        }
        this.out.push(")");
        break;
      case "ArrayPattern":
        this.out.push("(E11", String(node.elements.length));
        for (const element of node.elements) {
          if (element === null) this.out.push("(E0)");
          else this.target(element);
        }
        this.out.push(")");
        break;
      case "AssignmentPattern":
        this.out.push("(E20", "=");
        this.target(node.left);
        this.expression(node.right);
        this.out.push(")");
        break;
      case "RestElement":
        this.out.push("(E22");
        this.target(node.argument);
        this.out.push(")");
        break;
      default:
        this.expression(node);
    }
  }

  private sequence(expressions: readonly Node[]): void {
    if (expressions.length === 1) {
      this.expression(expressions[0]);
      return;
    }
    this.out.push("(E19", ",");
    this.sequence(expressions.slice(0, -1));
    this.expression(expressions[expressions.length - 1]);
    this.out.push(")");
  }

  private expression(node: Node): void {
    if (node.type === "ParenthesizedExpression") {
      this.expression(node.expression);
      return;
    }
    if (node.type === "SequenceExpression") {
      this.sequence(node.expressions);
      return;
    }
    this.out.push("(");
    switch (node.type) {
      case "Identifier":
        this.out.push("E1");
        this.identifier(node.name);
        break;
      case "ThisExpression":
        this.out.push("E2");
        break;
      case "NullLiteral":
        this.out.push("E3");
        break;
      case "BooleanLiteral":
        this.out.push(node.value ? "E4" : "E5");
        break;
      case "NumericLiteral":
        this.out.push("E6", String(node.value));
        break;
      case "StringLiteral":
        this.out.push("E7");
        this.text(node.value);
        break;
      case "BigIntLiteral":
        this.out.push("E8", String(node.value));
        break;
      case "RegExpLiteral":
        this.out.push("E9");
        this.text(node.pattern);
        this.text(node.flags);
        break;
      case "TemplateLiteral":
        this.out.push("E10", String(node.quasis.length));
        for (const quasi of node.quasis) this.text(quasi.value.cooked ?? quasi.value.raw);
        this.expressions(node.expressions);
        break;
      case "ArrayExpression":
        this.out.push("E11");
        this.expressions(node.elements);
        break;
      case "ObjectExpression":
        this.out.push("E12", String(node.properties.length));
        for (const property of node.properties) {
          if (property.type === "SpreadElement") {
            this.out.push("K1", "-");
            this.expression(property.argument);
          } else if (property.type === "ObjectMethod") {
            this.out.push(property.kind === "method" ? "K2" : property.kind === "get" ? "K3" : "K4");
            this.propertyKey(property);
            this.function(property);
          } else {
            this.out.push("K0");
            this.propertyKey(property);
            this.expression(property.value);
          }
        }
        break;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        this.out.push("E13");
        this.function(node);
        break;
      case "MemberExpression":
      case "OptionalMemberExpression":
        this.out.push(node.computed ? "E15" : "E14");
        this.chain(node);
        this.expression(node.object);
        if (node.computed) this.expression(node.property);
        else if (node.property.type === "Identifier") this.text(node.property.name);
        else this.refuse("a private name");
        break;
      case "CallExpression":
      case "OptionalCallExpression":
      case "NewExpression":
        this.out.push(node.type === "NewExpression" ? "E17" : "E16");
        this.chain(node);
        if (node.callee.type === "Import") this.refuse("import()");
        else this.expression(node.callee);
        this.expressions(node.arguments);
        break;
      case "UnaryExpression":
        if (node.operator === "!" && node.argument.type === "NumericLiteral")
          this.out.push(node.argument.value === 0 ? "E4" : "E5");
        else if (node.operator === "void" && node.argument.type === "NumericLiteral") this.out.push("E1", "U");
        else {
          this.out.push("E18", node.operator);
          this.expression(node.argument);
        }
        break;
      case "UpdateExpression":
        this.out.push("E18", node.prefix ? `${node.operator}x` : `x${node.operator}`);
        this.expression(node.argument);
        break;
      case "BinaryExpression":
      case "LogicalExpression":
        this.out.push(
          "E19",
          (node.operator === "==" || node.operator === "!=") && comparesTypeName(node.left, node.right)
            ? `${node.operator}=`
            : node.operator,
        );
        if (node.left.type === "PrivateName") this.refuse("a private name");
        else this.expression(node.left);
        this.expression(node.right);
        break;
      case "AssignmentExpression":
        this.out.push("E20", node.operator);
        this.target(node.left);
        this.expression(node.right);
        break;
      case "ConditionalExpression":
        this.out.push("E21");
        this.expression(node.test);
        this.expression(node.consequent);
        this.expression(node.alternate);
        break;
      case "SpreadElement":
        this.out.push("E22");
        this.expression(node.argument);
        break;
      case "AwaitExpression":
        this.out.push("E23");
        this.expression(node.argument);
        break;
      case "YieldExpression":
        this.out.push("E24", node.delegate ? "*" : "-");
        this.optionalExpression(node.argument);
        break;
      case "MetaProperty":
        if (node.meta.name === "new") this.out.push("E25");
        else this.refuse("import.meta");
        break;
      default:
        this.refuse(`the expression ${node.type}`);
    }
    this.out.push(")");
  }
}

export function canonicalFunction(root: Node, isOuterName: (name: string) => boolean): CanonicalFunction {
  const writer = new Writer(root, isOuterName);
  writer.function(root);
  return {
    tree: writer.out.join(" "),
    outerNames: writer.outerNames,
    globalNames: writer.globalNames,
    unsupported: writer.unsupported,
  };
}

export function textOf(source: string, node: Node): string {
  const text = source.slice(node.start, node.end).replaceAll("\r\n", "\n");
  if (text.includes("`")) return text;
  const lineStart = source.lastIndexOf("\n", node.start) + 1;
  const indentation = /^[ \t]*/.exec(source.slice(lineStart, node.start))![0];
  if (indentation === "") return text;
  return text.split("\n" + indentation).join("\n");
}
