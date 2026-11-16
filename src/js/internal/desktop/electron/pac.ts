// An interpreter for proxy auto-config scripts. They come from the network, so they get no realm to run in: a script
// reaches what the tables below list and nothing else.
type Scope = { names: Map<string, unknown>; parent: Scope | null; self: unknown };
type Code = (scope: Scope) => any;
type Reference = { get: Code; set: (scope: Scope, value: unknown) => void; target?: Code; key?: Code; name?: string };
type Token = { type: string; value: any; afterNewline: boolean };

const MAX_STEPS = 20_000_000;
const MAX_LENGTH = 1 << 24;
const MAX_SCRIPT_DEPTH = 400;
let steps = 0;
let depth = 0;

class Thrown {
  constructor(readonly value: unknown) {}
}
class Jump {
  constructor(
    readonly kind: string,
    readonly value?: unknown,
  ) {}
}
/** A script cannot catch it. */
class Abort extends Error {}

class Callable {
  properties: any = Object.create(objectPrototype);
  constructor(
    readonly run: (self: unknown, args: any[]) => unknown,
    readonly construct?: (args: any[]) => unknown,
  ) {}
}

const objectPrototype: any = Object.create(null);
const isObject = (value: unknown) => typeof value === "object" && value !== null;
/** What a script makes does not inherit from `Object.prototype`. */
const isPlain = (value: unknown) => isObject(value) && !(value instanceof Object);

function step() {
  if (++steps > MAX_STEPS) throw new Abort("The script takes too long");
}

function bounded(value: any) {
  if (typeof value !== "string" && !$isArray(value)) return value;
  if (value.length > MAX_LENGTH) throw new Abort("Out of memory");
  steps += value.length >> 6;
  return value;
}

function invoke(callee: unknown, self: unknown, args: unknown[]) {
  if (!(callee instanceof Callable)) throw new TypeError("Not a function");
  step();
  if (++depth > MAX_SCRIPT_DEPTH) throw new Abort("Too much recursion");
  try {
    return callee.run(self, args);
  } finally {
    depth--;
  }
}

function toPrimitive(value: any): any {
  if (!isObject(value)) return value;
  if ($isArray(value))
    return bounded(Array.prototype.map.$call(value, item => (item == null ? "" : toPrimitive(item))).join());
  if (value instanceof Callable) return "function";
  if (!isPlain(value)) return String(value);
  for (const name of ["valueOf", "toString"]) {
    const result = value[name] instanceof Callable ? invoke(value[name], value, []) : value;
    if (!isObject(result)) return result;
  }
  throw new TypeError("Cannot convert object to primitive value");
}
const toKey = (value: unknown) => String(toPrimitive(value));

const native = (run: (...args: any[]) => unknown) => new Callable((_, args) => bounded(run(...args)));
const primitive = (run: (...args: any[]) => unknown) => native((...args) => run(...args.map(toPrimitive)));

function methods(
  prototype: object,
  accepts: (self: unknown) => boolean,
  names: string,
  convert: (argument: unknown, index: number) => unknown,
) {
  const table = Object.create(objectPrototype);
  for (const name of names.trim().split(/\s+/)) {
    const method = prototype[name];
    table[name] = new Callable((self, args) => {
      if (!accepts(self)) throw new TypeError(name + " called on an incompatible receiver");
      steps += (self as any)?.length >> 4;
      return bounded(method.$apply(self, args.map(convert)));
    });
  }
  return table;
}
const forText = (value: unknown) =>
  value instanceof RegExp
    ? value
    : value instanceof Callable
      ? (...args: unknown[]) =>
          toPrimitive(invoke(value, undefined, args.slice(0, isObject(args.at(-1)) ? -1 : undefined)))
      : toPrimitive(value);
const strings = methods(
  String.prototype,
  self => self != null && !isObject(self),
  `charAt charCodeAt concat endsWith includes indexOf lastIndexOf localeCompare match replace replaceAll search slice
  split startsWith substr substring toLowerCase toString toUpperCase trim trimEnd trimStart valueOf`,
  forText,
);
const isArray = (self: unknown) => $isArray(self);
const arrays = Object.assign(
  methods(
    Array.prototype,
    isArray,
    "concat includes indexOf lastIndexOf pop push reverse shift slice splice unshift",
    it => it,
  ),
  methods(Array.prototype, isArray, "every filter find findIndex forEach map reduce some sort", (it, index) =>
    index === 0 && it !== undefined ? (...args: unknown[]) => invoke(it, undefined, args) : it,
  ),
);
arrays.join = new Callable((self: any, [separator]) =>
  bounded(
    Array.prototype.map
      .$call(isArray(self) ? self : [], item => (item == null ? "" : toPrimitive(item)))
      .join(toPrimitive(separator)),
  ),
);
arrays.toString = new Callable(toPrimitive);
const patterns = methods(RegExp.prototype, self => self instanceof RegExp, "exec test toString", toPrimitive);
const numbers = methods(Number.prototype, self => typeof self === "number", "toFixed toString valueOf", toPrimitive);
const dates = methods(
  Date.prototype,
  self => self instanceof Date,
  `getDate getDay getFullYear getHours getMinutes getMonth getSeconds getTime getTimezoneOffset getUTCDate getUTCDay
  getUTCFullYear getUTCHours getUTCMinutes getUTCMonth getUTCSeconds toISOString toString valueOf`,
  toPrimitive,
);
const functions = Object.assign(Object.create(objectPrototype), {
  "call": new Callable((self, [receiver, ...args]) => invoke(self, receiver, args)),
  "apply": new Callable((self, [receiver, args]) => invoke(self, receiver, $isArray(args) ? args : [])),
});
const own = (value: any) => (value instanceof Callable ? value.properties : value);
objectPrototype.hasOwnProperty = new Callable((self, [key]) => Object.hasOwn(own(self), toKey(key)));
objectPrototype.toString = new Callable(self => ($isArray(self) ? "[object Array]" : "[object Object]"));
objectPrototype.valueOf = new Callable(self => self);

function get(value: any, key: string | number) {
  if (value == null) throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`);
  if (typeof value === "string") return Object.hasOwn(value as any, key) ? value[key] : strings[key];
  if ($isArray(value)) return Object.hasOwn(value, key) ? value[key] : arrays[key];
  if (value instanceof Callable) return value.properties[key] ?? functions[key];
  if (value instanceof RegExp) {
    return /^(?:source|flags|global|ignoreCase|lastIndex|multiline)$/.test(key as string) ? value[key] : patterns[key];
  }
  if (value instanceof Date) return dates[key];
  if (typeof value !== "object") return typeof value === "number" ? numbers[key] : objectPrototype[key];
  if (!isPlain(value)) throw new Abort("Not an object of the script");
  return key === "__proto__" ? Object.getPrototypeOf(value) : value[key];
}

function set(target: any, key: string | number, value: unknown) {
  if (target == null) throw new TypeError(`Cannot set properties of ${target}`);
  if (target instanceof RegExp) {
    if (key === "lastIndex") target.lastIndex = +toPrimitive(value);
  } else if ($isArray(target)) {
    if (key === "__proto__" || +key >= MAX_LENGTH) throw new Abort("Invalid array index");
    if (key === "length") target.length = Math.min(+toPrimitive(value), MAX_LENGTH);
    else target[key] = value;
  } else if (key === "__proto__") {
    if (isPlain(target) && (value === null || isPlain(value))) Object.setPrototypeOf(target, value as object);
  } else if (isPlain((target = own(target)))) target[key] = value;
}

function lookUp(scope: Scope | null, name: string) {
  while (scope !== null && !scope.names.$has(name)) scope = scope.parent;
  return scope;
}

const binary: Record<string, [precedence: number, run: (a: any, b: any) => unknown]> = {
  __proto__: null as any,
  "|": [4, (a, b) => a | b],
  "^": [5, (a, b) => a ^ b],
  "&": [6, (a, b) => a & b],
  "==": [7, (a, b) => a == b],
  "!=": [7, (a, b) => a != b],
  "===": [7, (a, b) => a === b],
  "!==": [7, (a, b) => a !== b],
  "<": [8, (a, b) => a < b],
  ">": [8, (a, b) => a > b],
  "<=": [8, (a, b) => a <= b],
  ">=": [8, (a, b) => a >= b],
  "in": [8, (a, b) => get(b, toKey(a)) !== undefined || Object.hasOwn(own(b), toKey(a))],
  "instanceof": [8, (a, b) => isInstance(a, get(b, "prototype"))],
  "<<": [9, (a, b) => a << b],
  ">>": [9, (a, b) => a >> b],
  ">>>": [9, (a, b) => a >>> b],
  "+": [10, (a, b) => bounded(a + b)],
  "-": [10, (a, b) => a - b],
  "*": [11, (a, b) => a * b],
  "/": [11, (a, b) => a / b],
  "%": [11, (a, b) => a % b],
};
const logical = { __proto__: null, "??": 1, "||": 2, "&&": 3 } as any;

function isInstance(value: any, prototype: unknown) {
  if (!isPlain(value)) return prototype === ($isArray(value) ? arrays : value instanceof RegExp ? patterns : false);
  while ((value = Object.getPrototypeOf(value)) !== null) if (value === prototype) return true;
  return false;
}

function operate(operator: string) {
  const takesObjects = /^(?:[=!]==|in.*)$/.test(operator);
  const run = binary[operator][1];
  if (takesObjects) return run;
  if (operator === "==" || operator === "!=") {
    return (a, b) => (isObject(a) === isObject(b) ? run(a, b) : run(toPrimitive(a), toPrimitive(b)));
  }
  return (a, b) => run(toPrimitive(a), toPrimitive(b));
}

const spaces = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/y;
const lexemes: [string, RegExp][] = [
  ["number", /0[xX][\da-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y],
  ["name", /[\p{ID_Start}_\x24][\p{ID_Continue}\x24]*/uy],
  ["string", /\x22(?:[^\x22\\\n]|\\[^])*\x22|\x27(?:[^\x27\\\n]|\\[^])*\x27/y],
  ["pattern", /\x2f(?:[^\x2f\\[\n]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\x2f[a-z]*/y],
  ["symbol", />>>=?|[=!]==|=>|<<=?|>>=?|&&|\|\||\?\?|\+\+|--|[-+*\x2f%&|^<>=!]=?|[\x28\x29\x7b\x7d\x5b\x5d;,.?:~]/y],
];
const escapes = { __proto__: null, n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0", "\n": "" } as any;
const unescape = (text: string) =>
  text.replace(/\\(?:x(..)|u(....)|\r?([^]))/g, (_, byte, unit, other) =>
    other === undefined ? String.fromCharCode(parseInt(byte ?? unit, 16)) : (escapes[other] ?? other),
  );

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  for (let at = 0; ;) {
    spaces.lastIndex = at;
    const skipped = spaces.exec(source)![0];
    const afterNewline = skipped.includes("\n");
    at += skipped.length;
    if (at >= source.length) return tokens.concat({ type: "end", value: "", afterNewline: true });
    const last = tokens.at(-1);
    const followsValue =
      last !== undefined &&
      (last.type === "symbol"
        ? ")]}".includes(last.value)
        : !/^(?:return|typeof|case|in|of|else|void)$/.test(last.value));
    const found = lexemes.find(([type, pattern]) => {
      pattern.lastIndex = at;
      return !(type === "pattern" && followsValue) && pattern.test(source);
    });
    if (!found) throw new SyntaxError(`Unexpected '${source[at]}'`);
    const [type, { lastIndex }] = found;
    const text = source.slice(at, (at = lastIndex));
    const value = type === "number" ? +text : type === "string" ? unescape(text.slice(1, -1)) : text;
    tokens.push({ type, value, afterNewline });
  }
}

function compile(source: string): Code {
  const tokens = tokenize(source);
  const references = new Map<Code, Reference>();
  let at = 0;
  let nesting = 0;
  let allowsIn = true;
  /** What the function that is being parsed hoists. */
  let hoisted: { names: string[]; functions: [string, Code][] };

  const is = (value: string, ahead = 0) => {
    const token = tokens[at + ahead];
    return token?.value === value && (token.type === "symbol" || token.type === "name");
  };
  const eat = (value: string) => is(value) && (at++, true);
  function expect(value: string) {
    if (!eat(value)) throw new SyntaxError(`Expected '${value}' but found '${tokens[at].value}'`);
  }
  function name(): string {
    if (tokens[at].type !== "name") throw new SyntaxError(`Unexpected '${tokens[at].value}'`);
    return tokens[at++].value;
  }
  function list<T>(end: string, item: () => T) {
    const items: T[] = [];
    while (!eat(end)) {
      items.push(item());
      if (!is(end)) expect(",");
    }
    return items;
  }
  function nested<T>(parse: () => T, withIn = true) {
    if (++nesting > MAX_SCRIPT_DEPTH) throw new SyntaxError("Too much nesting");
    const before = allowsIn;
    allowsIn = withIn;
    const result = parse();
    allowsIn = before;
    nesting--;
    return result;
  }
  function refer(reference: Reference) {
    references.$set(reference.get, reference);
    return reference.get;
  }
  function referenceOf(code: Code) {
    const reference = references.$get(code);
    if (!reference) throw new SyntaxError("Invalid assignment target");
    return reference;
  }
  const variable = (name: string) =>
    refer({
      name,
      get(scope) {
        const found = lookUp(scope, name);
        if (found === null) throw new ReferenceError(name + " is not defined");
        return found.names.$get(name);
      },
      set(scope, value) {
        while (scope.parent !== null && !scope.names.$has(name)) scope = scope.parent;
        scope.names.$set(name, value);
      },
    });
  const member = (target: Code, key: Code) =>
    refer({
      target,
      key,
      get: scope => get(target(scope), key(scope)),
      set: (scope, value) => set(target(scope), key(scope), value),
    });

  function body(parse: () => Code): Code {
    const outer = hoisted;
    const { names, functions } = (hoisted = { names: [], functions: [] });
    const code = parse();
    hoisted = outer;
    return scope => {
      for (const name of names) if (!scope.names.$has(name)) scope.names.$set(name, undefined);
      for (const [name, create] of functions) scope.names.$set(name, create(scope));
      return code(scope);
    };
  }

  function closure(parameters: string[], isArrow: boolean, ownName?: string): Code {
    const hasBlock = is("{");
    const code = body(() => nested(hasBlock ? block : assignment));
    return outer => {
      const result = new Callable((self, args) => {
        const scope: Scope = { names: new Map(), parent: outer, self: isArrow ? outer.self : self };
        if (ownName) scope.names.$set(ownName, result);
        if (!isArrow) scope.names.$set("arguments", args);
        for (let i = 0; i < parameters.length; i++) scope.names.$set(parameters[i], args[i]);
        const completion = code(scope);
        return hasBlock ? completion?.value : completion;
      });
      result.properties.prototype = Object.assign(Object.create(objectPrototype), { constructor: result });
      return result;
    };
  }
  function method(ownName?: string) {
    expect("(");
    return closure(list(")", name), false, ownName);
  }

  function property(): (scope: Scope, object: object) => void {
    const isAccessor = (is("get") || is("set")) && !":,(}".includes(tokens[at + 1].value);
    const kind = isAccessor && name();
    const key = String(tokens[at++].value);
    if (kind) {
      if (/^\d/.test(key)) throw new SyntaxError("Unexpected accessor");
      const create = method();
      return (scope, object) => {
        const accessor = create(scope);
        const run = function (this: unknown, value: unknown) {
          return invoke(accessor, this, [value]);
        };
        Object.defineProperty(object, key, { [kind]: run, configurable: true, enumerable: true });
      };
    }
    const value = eat(":") ? assignment() : is("(") ? method() : variable(key);
    if (key === "__proto__") return (scope, object) => set(object, key, value(scope));
    return (scope, object) => $putByValDirect(object, key, value(scope));
  }

  function primary(): Code {
    const { type, value } = tokens[at++];
    if (type === "number" || type === "string") return () => value;
    if (type === "pattern") {
      const end = value.lastIndexOf("/");
      return () => new RegExp(value.slice(1, end), value.slice(end + 1));
    }
    if (type === "name") {
      if (value === "function") return method(is("(") ? undefined : name());
      if (value === "this") return scope => scope.self;
      if (value === "null" || value === "true" || value === "false")
        return () => (value === "null" ? null : value === "true");
      if (value === "new") {
        const callee = nested(() => suffixes(primary(), false));
        const args = eat("(") ? list(")", assignment) : [];
        return scope => {
          const constructor = callee(scope);
          const given = args.map(it => it(scope));
          if (constructor instanceof Callable && constructor.construct) return constructor.construct(given);
          const prototype = get(constructor, "prototype");
          const self = Object.create(isPlain(prototype) ? prototype : objectPrototype);
          const result = invoke(constructor, self, given);
          return isObject(result) ? result : self;
        };
      }
      return eat("=>") ? closure([value], true) : variable(value);
    }
    if (value === "(") {
      let end = at;
      while (tokens[end].type === "name" || tokens[end].value === ",") end++;
      if (is(")", end - at) && is("=>", end - at + 1)) {
        const parameters = list(")", name);
        at++;
        return closure(parameters, true);
      }
      const inner = nested(expression);
      expect(")");
      return inner;
    }
    if (value === "[") {
      const items = nested(() => list("]", assignment));
      return scope => items.map(it => it(scope));
    }
    if (value !== "{") throw new SyntaxError(`Unexpected '${value}'`);
    const properties = nested(() => list("}", property));
    return scope => {
      const object = Object.create(objectPrototype);
      for (const define of properties) define(scope, object);
      return object;
    };
  }

  function suffixes(code: Code, calls: boolean): Code {
    while (true) {
      if (eat(".")) {
        const key = name();
        code = member(code, () => key);
      } else if (eat("[")) {
        const key = nested(expression);
        expect("]");
        code = member(code, scope => {
          const value = key(scope);
          return typeof value === "number" ? value : toKey(value);
        });
      } else if (calls && eat("(")) {
        const args = nested(() => list(")", assignment));
        const { target, key } = references.$get(code) ?? {};
        const callee = code;
        code = scope => {
          const self = target?.(scope);
          return invoke(
            target ? get(self, key!(scope)) : callee(scope),
            self,
            args.map(it => it(scope)),
          );
        };
      } else return code;
    }
  }

  function increment({ get, set }: Reference, by: number, returnsOld: boolean): Code {
    return scope => {
      const old = +toPrimitive(get(scope));
      set(scope, old + by);
      return returnsOld ? old : old + by;
    };
  }

  function unary(): Code {
    const operator = ["!", "-", "+", "~", "++", "--", "typeof", "void", "delete"].find(eat);
    if (operator === undefined) {
      const operand = suffixes(primary(), true);
      if (tokens[at].afterNewline || !(is("++") || is("--"))) return operand;
      return increment(referenceOf(operand), tokens[at++].value === "++" ? 1 : -1, true);
    }
    const operand = nested(unary, allowsIn);
    switch (operator) {
      case "!":
        return scope => !operand(scope);
      case "-":
        return scope => -toPrimitive(operand(scope));
      case "+":
        return scope => +toPrimitive(operand(scope));
      case "~":
        return scope => ~toPrimitive(operand(scope));
      case "void":
        return scope => void operand(scope);
      case "delete": {
        const { target, key } = referenceOf(operand);
        return scope => !!target && Reflect.deleteProperty(Object(own(target(scope))), key!(scope));
      }
      case "typeof": {
        const name = references.$get(operand)?.name;
        return scope => {
          const value = name !== undefined && lookUp(scope, name) === null ? undefined : operand(scope);
          return value instanceof Callable ? "function" : typeof value;
        };
      }
    }
    return increment(referenceOf(operand), operator === "++" ? 1 : -1, false);
  }

  function operands(above: number): Code {
    let left = unary();
    while (true) {
      const { type, value: operator } = tokens[at];
      const isOperator = type === "symbol" || (type === "name" && (allowsIn || operator !== "in"));
      const precedence = isOperator && (logical[operator] ?? binary[operator]?.[0]);
      if (!(precedence > above)) return left;
      if (operator in logical) {
        // One list for a whole chain: scripts have thousands of alternatives in a row.
        const all = [left];
        while (eat(operator)) all.push(operands(precedence));
        left = scope => {
          let value;
          for (const each of all) {
            value = each(scope);
            if (operator === "&&" ? !value : operator === "||" ? value : value != null) break;
          }
          return value;
        };
        continue;
      }
      at++;
      const [first, second, run] = [left, operands(precedence), operate(operator)];
      left = scope => run(first(scope), second(scope));
    }
  }

  function assignment(): Code {
    const left = operands(0);
    if (eat("?")) {
      const yes = nested(assignment);
      expect(":");
      const no = nested(assignment, allowsIn);
      return scope => (left(scope) ? yes(scope) : no(scope));
    }
    const { type, value: operator } = tokens[at];
    if (type !== "symbol" || !operator.endsWith("=")) return left;
    at++;
    const { set } = referenceOf(left);
    const right = nested(assignment, allowsIn);
    const run = operator !== "=" && operate(operator.slice(0, -1));
    return scope => {
      const value = run ? run(left(scope), right(scope)) : right(scope);
      set(scope, value);
      return value;
    };
  }

  function expression(): Code {
    const first = assignment();
    if (!eat(",")) return first;
    const rest = nested(expression, allowsIn);
    return scope => (first(scope), rest(scope));
  }

  /** `let` and `const` are `var`. */
  function declarations(): Code {
    const all: Code[] = [];
    let last;
    do {
      const declared = name();
      const { set } = referenceOf((last = variable(declared)));
      const value = eat("=") && assignment();
      hoisted.names.push(declared);
      if (value) all.push(scope => set(scope, value(scope)));
    } while (eat(","));
    return refer({ ...referenceOf(last), get: scope => all.forEach(it => it(scope)) });
  }

  function sequence(ends: () => boolean): Code {
    const all: Code[] = [];
    while (!ends()) all.push(nested(statement));
    return scope => {
      for (const each of all) {
        const jump = each(scope);
        if (jump) return jump;
      }
    };
  }

  function block() {
    expect("{");
    return sequence(() => eat("}"));
  }

  function condition() {
    expect("(");
    const test = expression();
    expect(")");
    return test;
  }

  function loop(labels: string[], code: Code, advance: (scope: Scope) => Iterable<unknown>): Code {
    return scope => {
      for (const _ of advance(scope)) {
        step();
        const jump: Jump | undefined = code(scope);
        if (!jump) continue;
        if (jump.kind === "return" || (jump.value && !labels.includes(jump.value as string))) return jump;
        if (jump.kind === "break") break;
      }
    };
  }

  function forStatement(labels: string[]): Code {
    expect("(");
    const declares = eat("var") || eat("let") || eat("const");
    const start = is(";") ? undefined : nested(declares ? declarations : expression, false);
    if (is("in") || is("of")) {
      const wantsKeys = name() === "in";
      const { set } = referenceOf(start!);
      const subject = expression();
      expect(")");
      return loop(labels, nested(statement), function* (scope) {
        const value = subject(scope);
        if (!wantsKeys) for (const item of $isArray(value) ? value : toKey(value)) yield set(scope, item);
        else for (const key in own(value)) if (!(key in objectPrototype)) yield set(scope, key);
      });
    }
    expect(";");
    const test = is(";") ? undefined : expression();
    expect(";");
    const update = is(")") ? undefined : expression();
    expect(")");
    return loop(labels, nested(statement), function* (scope) {
      for (start?.(scope); !test || test(scope); update?.(scope)) yield;
    });
  }

  function switchStatement(): Code {
    const subject = condition();
    const cases: [test: Code | undefined, code: Code][] = [];
    expect("{");
    while (!eat("}")) {
      const test = eat("default") ? undefined : (expect("case"), expression());
      expect(":");
      cases.push([test, sequence(() => is("case") || is("default") || is("}"))]);
    }
    return scope => {
      const value = subject(scope);
      let index = cases.findIndex(([test]) => test && test(scope) === value);
      if (index < 0) index = cases.findIndex(([test]) => !test);
      for (; cases[index]; index++) {
        const jump = cases[index][1](scope);
        if (jump) return jump.kind === "break" && !jump.value ? undefined : jump;
      }
    };
  }

  function tryStatement(): Code {
    const code = block();
    let caught: string | undefined;
    const handles = eat("catch");
    if (handles && eat("(")) {
      hoisted.names.push((caught = name()));
      expect(")");
    }
    const handler = handles && block();
    const last = eat("finally") && block();
    const guarded: Code = scope => {
      try {
        return code(scope);
      } catch (error: any) {
        if (!handler || error instanceof Abort) throw error;
        if (caught)
          scope.names.$set(caught, error instanceof Thrown ? error.value : createError(error.name, error.message));
        return handler(scope);
      }
    };
    if (!last) return guarded;
    return scope => {
      let jump;
      try {
        jump = guarded(scope);
      } catch (error) {
        if (error instanceof Abort || !(jump = last(scope))) throw error;
        return jump;
      }
      return last(scope) ?? jump;
    };
  }

  function statement(labels: string[] = []): Code {
    if (is("{")) return block();
    if (eat(";")) return () => {};
    if (tokens[at].type === "name" && is(":", 1)) {
      const label = name();
      at++;
      const code = nested(() => statement([...labels, label]));
      return scope => {
        const jump = code(scope);
        return jump?.kind === "break" && jump.value === label ? undefined : jump;
      };
    }
    if (eat("function")) {
      const entry: [string, Code] = [name(), undefined as any];
      hoisted.functions.push(entry);
      entry[1] = method();
      return () => {};
    }
    if (eat("if")) {
      const branches: [Code, Code][] = [];
      let otherwise: Code | undefined;
      while (true) {
        branches.push([condition(), nested(statement)]);
        if (!eat("else")) break;
        if (eat("if")) continue;
        otherwise = nested(statement);
        break;
      }
      return scope => (branches.find(([test]) => test(scope))?.[1] ?? otherwise)?.(scope);
    }
    if (eat("for")) return forStatement(labels);
    if (eat("switch")) return switchStatement();
    if (eat("try")) return tryStatement();
    if (eat("while")) {
      const test = condition();
      return loop(labels, nested(statement), function* (scope) {
        while (test(scope)) yield;
      });
    }
    if (eat("do")) {
      const code = nested(statement);
      expect("while");
      const test = condition();
      return loop(labels, code, function* (scope) {
        do yield;
        while (test(scope));
      });
    }
    let code: Code;
    const keyword = ["return", "throw", "break", "continue"].find(eat);
    const isBare = is(";") || is("}") || tokens[at].afterNewline;
    if (keyword === "break" || keyword === "continue") {
      const jump = new Jump(keyword, isBare ? undefined : name());
      code = () => jump;
    } else if (keyword === "return") {
      const value = isBare ? undefined : expression();
      code = scope => new Jump(keyword, value?.(scope));
    } else if (keyword === "throw") {
      const value = expression();
      code = scope => {
        throw new Thrown(value(scope));
      };
    } else {
      const value = eat("var") || eat("let") || eat("const") ? declarations() : expression();
      code = scope => void value(scope);
    }
    if (!eat(";") && !is("}") && !tokens[at].afterNewline) expect(";");
    return code;
  }

  return body(() => sequence(() => tokens[at].type === "end"));
}

const createError = (name: string, message: unknown) =>
  Object.assign(Object.create(objectPrototype), { name, message, toString: native(() => `${name}: ${message}`) });

function constructor(run: (...args: any[]) => unknown, prototype: object, statics: object = {}) {
  const result = new Callable(
    (_, args) => bounded(run(...args)),
    args => bounded(run(...args)),
  );
  Object.assign(result.properties, statics, { prototype });
  return result;
}

const toNumber = (address: string) => address.split(".").reduce((sum, part) => sum * 256 + +part, 0);
const isIPv4 = (text: string) => require("node:net").isIPv4(text);
const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const isBetween = (now: number, from: number, to: number) =>
  from <= to ? from <= now && now <= to : now >= from || now <= to;

/** `run` reads the UTC fields of `now`. */
const dated = (run: (now: Date, args: any[]) => boolean) =>
  primitive((...args) => {
    const now = new Date();
    if (args.at(-1) === "GMT") args.pop();
    else now.setUTCMinutes(now.getUTCMinutes() - now.getTimezoneOffset());
    return args.length > 0 && run(now, args);
  });

function globals(resolve: (host: string) => string[]) {
  const first = (host: string) => (isIPv4(host) ? host : (resolve(String(host)).find(isIPv4) ?? null));
  const addresses = () =>
    Object.values<any>(require("node:os").networkInterfaces())
      .flat()
      .filter(it => !it.internal)
      .map(it => it.address);
  const math = Object.create(objectPrototype);
  for (const name of ["abs", "ceil", "floor", "max", "min", "pow", "random", "round", "sqrt"]) {
    math[name] = primitive(Math[name]);
  }
  return {
    undefined,
    NaN,
    Infinity,
    Math: math,
    Array: constructor(
      (...items) =>
        items.length === 1 && typeof items[0] === "number" ? new Array(Math.min(items[0], MAX_LENGTH)) : items,
      arrays,
      { isArray: native(value => $isArray(value)) },
    ),
    Boolean: native(value => !!value),
    Date: constructor((...args) => new (Date as any)(...args.map(toPrimitive)), dates, { now: native(Date.now) }),
    Error: constructor(message => createError("Error", message), objectPrototype),
    Number: primitive(Number),
    Object: constructor(() => Object.create(objectPrototype), objectPrototype, {
      create: native(prototype => Object.create(isPlain(prototype) ? prototype : null)),
      keys: native(value => Object.keys(own(value))),
      values: native(value => Object.values(own(value))),
    }),
    RegExp: constructor((source, flags) => new RegExp(forText(source) as string, toPrimitive(flags)), patterns),
    String: constructor((value = "") => toKey(value), strings, { fromCharCode: primitive(String.fromCharCode) }),
    decodeURIComponent: primitive(decodeURIComponent),
    encodeURIComponent: primitive(encodeURIComponent),
    isNaN: primitive(isNaN),
    parseFloat: primitive(parseFloat),
    parseInt: primitive(parseInt),

    alert: native(() => {}),
    convert_addr: primitive(address => toNumber(address) | 0),
    dnsDomainIs: primitive((host, domain) => host.endsWith(domain)),
    dnsDomainLevels: primitive(host => host.split(".").length - 1),
    dnsResolve: primitive(first),
    dnsResolveEx: primitive(host => resolve(String(host)).join(";")),
    isInNet: primitive((host, pattern, mask) => {
      const address = isIPv4(pattern) && isIPv4(mask) && first(host);
      return !!address && (toNumber(address) & toNumber(mask)) === (toNumber(pattern) & toNumber(mask));
    }),
    isInNetEx: primitive((address, prefix) => {
      const [network, bits] = prefix.split("/");
      const family = isIPv4(network) ? "ipv4" : "ipv6";
      const list = new (require("node:net").BlockList)();
      list.addSubnet(network, +bits, family);
      return address.split(";").some(it => list.check(it, isIPv4(it) ? "ipv4" : "ipv6"));
    }),
    isPlainHostName: primitive(host => !host.includes(".") && !host.includes(":")),
    isResolvable: primitive(host => first(host) !== null),
    isResolvableEx: primitive(host => resolve(String(host)).length > 0),
    localHostOrDomainIs: primitive((host, full) => host === full || full.startsWith(host + ".")),
    myIpAddress: native(() => addresses().find(isIPv4) ?? "127.0.0.1"),
    myIpAddressEx: native(() => addresses().join(";")),
    shExpMatch: primitive((text, pattern) => {
      const source = pattern.replaceAll(".", "\\.").replaceAll("*", ".*").replaceAll("?", ".");
      return new RegExp("^" + source + "$").test(text);
    }),
    weekdayRange: dated((now, [from, to = from]) => isBetween(now.getUTCDay(), days.indexOf(from), days.indexOf(to))),
    timeRange: dated((now, args) => {
      const size = Math.max(args.length >> 1, 1);
      const seconds = ([h, m, s]: number[], rest: number) => h * 3600 + (m ?? rest) * 60 + (s ?? rest);
      const current = seconds([now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()], 0);
      return isBetween(current, seconds(args.slice(0, size), 0), seconds(args.slice(-size), 59));
    }),
    dateRange: dated((now, args) => {
      const size = Math.max(args.length >> 1, 1);
      const weigh = (part: any) =>
        typeof part === "string" ? months.indexOf(part) * 32 : part > 31 ? part * 512 : part;
      const today = (part: any) =>
        typeof part === "string" ? months[now.getUTCMonth()] : part > 31 ? now.getUTCFullYear() : now.getUTCDate();
      const total = (parts: any[]) => parts.reduce((sum, part) => sum + weigh(part), 0);
      const [from, to] = [args.slice(0, size), args.slice(-size)];
      return isBetween(total(from.map(today)), total(from), total(to));
    }),
  };
}

class NeedsAddresses extends Abort {
  constructor(readonly host: string) {
    super();
  }
}

/** Returns `FindProxyForURL()`. A call that needs a name resolved is run again once the answer is there. */
function load(source: string, lookUpHost: (host: string) => Promise<string[]>) {
  let known = new Map<string, string[]>();
  const resolve = (host: string) => {
    const found = known.$get(host);
    if (!found) throw new NeedsAddresses(host);
    return found;
  };
  const program = compile(source);
  let scope: Scope | undefined;
  return function find(url: string, host: string, resolved = new Map<string, string[]>()): string | Promise<string> {
    known = resolved;
    steps = depth = 0;
    try {
      if (!scope) {
        const fresh = { names: new Map(Object.entries(globals(resolve))), parent: null, self: undefined };
        program(fresh);
        scope = fresh;
      }
      const { names } = scope;
      return toKey(invoke(names.$get("FindProxyForURLEx") ?? names.$get("FindProxyForURL"), undefined, [url, host]));
    } catch (error) {
      if (error instanceof Thrown) throw new Error("FindProxyForURL() has thrown");
      if (!(error instanceof NeedsAddresses) || resolved.$size >= 20) throw error;
      return lookUpHost(error.host).then(addresses => find(url, host, resolved.set(error.host, addresses)));
    }
  };
}

export default { load };
