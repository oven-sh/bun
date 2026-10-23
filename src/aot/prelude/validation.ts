declare function $arrayFrom<T>(items: Iterable<T> | ArrayLike<T>): T[];
declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $hasOwn(object: object, key: PropertyKey): boolean;
declare function $isArray(value: any): value is any[];
declare function $jsonParse(text: string): any;
declare function $jsonStringify(value: unknown): string;
declare function $min(a: number, b: number): number;
declare function $numberIsFinite(value: unknown): boolean;
declare function $numberIsInteger(value: unknown): boolean;
declare function $objectKeys(object: object): string[];
declare function $putByValDirect(object: object, key: PropertyKey, value: unknown): void;
declare function $urlCanParse(url: string): boolean;
declare const $Map: MapConstructor;
declare const $Object: ObjectConstructor;
declare const $Set: SetConstructor;

type PlanLiteral = null | boolean | number | string;

type PlanRule = {
  rule:
    | "Integer"
    | "Minimum"
    | "Maximum"
    | "ExclusiveMinimum"
    | "ExclusiveMaximum"
    | "MultipleOf"
    | "MinimumLength"
    | "MaximumLength"
    | "Pattern"
    | "Format"
    | "Template"
    | "Message"
    | "DefaultNull"
    | "DefaultBoolean"
    | "DefaultNumber"
    | "DefaultString";
  bound?: number;
  divisor?: number;
  length?: number;
  format?: string;
  source?: string;
  texts?: string[];
  placeholders?: string;
};

type PlanMember = { key: string; node: number; isOptional: boolean; mustBeOwn: boolean };

type PlanDiscriminant = { key: string; tags: PlanLiteral[]; tagged: number[]; untagged: number[]; expected: string };

type PlanNode = {
  shape:
    | "Unknown"
    | "Never"
    | "Undefined"
    | "Null"
    | "AnyObject"
    | "Primitive"
    | "BooleanLiteral"
    | "NumberLiteral"
    | "StringLiteral"
    | "Array"
    | "Tuple"
    | "Dictionary"
    | "Object"
    | "Union";
  primitive?: "string" | "number" | "boolean" | "bigint";
  value?: boolean | number | string;
  element?: number;
  elements?: number[];
  arms?: number[];
  members?: PlanMember[];
  undeclared?: "Allowed" | "Rejected" | "Validated";
  undeclaredValue?: number;
  discriminant?: PlanDiscriminant;
  remembers?: boolean;
  rules?: PlanRule[];
  message?: string;
  default?: PlanLiteral;
  text?: string;
};

type Plan = PlanNode[];

interface Run {
  nodes: Plan;
  refused: object;
  verdicts: Map<object, unknown[]> | undefined;
  remainingIssues: number;
  reported: Map<object, unknown[]> | undefined;
  optionalUnions: Map<number, number> | undefined;
  expressions: Map<string, RegExp>;
  copies: Set<object>;
}

function maxIssueCount(): number {
  return 100;
}

function createRun(nodes: Plan): Run {
  return {
    nodes,
    refused: {},
    verdicts: undefined,
    remainingIssues: maxIssueCount(),
    reported: undefined,
    optionalUnions: undefined,
    expressions: new $Map(),
    copies: new $Set(),
  };
}

function describeReceived(value: any): string {
  if (value === null) return "null";
  if ($isArray(value)) return "array";
  if (typeof value === "number") return $numberIsFinite(value) ? "number" : value !== value ? "nan" : "infinity";
  if (typeof value === "string") return "string";
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return typeof value;
}

function quoteReceived(value: any, kind: string): string {
  if (typeof value === "string") return $jsonStringify(value.length > 40 ? value.slice(0, 40) + "..." : value);
  return typeof value === "number" || typeof value === "boolean" ? String(value) : kind;
}

function describeArm(run: Run, at: number): string {
  const node = run.nodes[at];
  if (node.shape !== "Object") return expectedOf(run, at);
  if (node.text !== undefined) return node.text;
  const members = node.members;
  if (members === undefined || members.length === 0) return "{}";
  let text = "{ " + members[0].key;
  for (let i = 1; i < members.length && i < 4; i++) text += ", " + members[i].key;
  return text + (members.length > 4 ? ", ... }" : " }");
}

function expectedOf(run: Run, at: number): string {
  const node = run.nodes[at];
  switch (node.shape) {
    case "Unknown":
      return "unknown";
    case "Never":
      return "never";
    case "Undefined":
      return "undefined";
    case "Null":
      return "null";
    case "Primitive":
      return node.primitive!;
    case "BooleanLiteral":
    case "NumberLiteral":
    case "StringLiteral":
      return $jsonStringify(node.value);
    case "Array":
      return "array";
    case "Tuple":
      return "tuple";
    case "AnyObject":
    case "Dictionary":
    case "Object":
      return "object";
    case "Union": {
      const arms = node.arms ?? [];
      let text = "";
      for (let i = 0; i < arms.length; i++) text += (i === 0 ? "" : " | ") + describeArm(run, arms[i]);
      return text;
    }
  }
}

function isObject(value: any): boolean {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isPlainObject(value: any): boolean {
  return isObject(value) && !$isArray(value);
}

function matchesPlaceholder(kind: string, part: string): boolean {
  if (kind === "s") return true;
  if (kind === "n") return part !== "" && $numberIsFinite(+part);
  return /^-?(?:0|[1-9][0-9]*|0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)$/.test(part);
}

function matchesTemplate(texts: string[], placeholders: string, value: string): boolean {
  const last = texts.length - 1;
  if (
    value.length < texts[0].length + texts[last].length ||
    !value.startsWith(texts[0]) ||
    !value.endsWith(texts[last])
  )
    return false;
  const end = value.length - texts[last].length;
  let position = texts[0].length;
  for (let i = 1; i < last; i++) {
    const partEnd = texts[i] === "" ? position + 1 : value.indexOf(texts[i], position);
    const next = partEnd + texts[i].length;
    if (partEnd < 0 || next > end || !matchesPlaceholder(placeholders[i - 1], value.slice(position, partEnd)))
      return false;
    position = next;
  }
  return matchesPlaceholder(placeholders[last - 1], value.slice(position, end));
}

function expressionOf(run: Run, source: string): RegExp {
  let expression = run.expressions.get(source);
  if (expression === undefined) {
    expression = new RegExp(source);
    run.expressions.set(source, expression);
  }
  return expression;
}

function holds(run: Run, rule: PlanRule, value: any): boolean {
  switch (rule.rule) {
    case "Integer":
      return $numberIsInteger(value);
    case "Minimum":
      return value >= rule.bound!;
    case "Maximum":
      return value <= rule.bound!;
    case "ExclusiveMinimum":
      return value > rule.bound!;
    case "ExclusiveMaximum":
      return value < rule.bound!;
    case "MultipleOf":
      return value % rule.divisor! === 0;
    case "MinimumLength":
      return value.length >= rule.length!;
    case "MaximumLength":
      return value.length <= rule.length!;
    case "Pattern":
      return expressionOf(run, rule.source!).test(value);
    case "Format":
      return rule.source ? expressionOf(run, rule.source).test(value) : $urlCanParse(value);
    case "Template":
      return matchesTemplate(rule.texts!, rule.placeholders!, value);
    case "Message":
    case "DefaultNull":
    case "DefaultBoolean":
    case "DefaultNumber":
    case "DefaultString":
      return true;
  }
}

function allHold(run: Run, node: PlanNode, value: any): boolean {
  const rules = node.rules;
  if (rules === undefined) return true;
  for (let i = 0; i < rules.length; i++) {
    if (!holds(run, rules[i], value)) return false;
  }
  return true;
}

function isDeclared(members: PlanMember[], key: string): boolean {
  for (let i = 0; i < members.length; i++) {
    if (members[i].key === key) return true;
  }
  return false;
}

function define(target: any, key: any, value: any): void {
  $putByValDirect(target, key, value);
}

function memberOf(input: any, member: { key: string }): any {
  return $call<boolean>($Object.prototype.propertyIsEnumerable, input, member.key) ? input[member.key] : undefined;
}

function addOnce(list: number[], at: number): void {
  if (!list.includes(at)) list.push(at);
}

function kindsDescribedAt(run: Run, at: number): { arrays: boolean; otherObjects: boolean } {
  const kinds = { arrays: false, otherObjects: false };
  const alternatives = [at];
  for (let i = 0; i < alternatives.length; i++) {
    const node = run.nodes[alternatives[i]];
    const arms = node.shape === "Union" ? (node.arms ?? []) : [];
    for (let j = 0; j < arms.length; j++) addOnce(alternatives, arms[j]);
    if (node.shape === "Array" || node.shape === "Tuple") kinds.arrays = true;
    else if (node.shape === "Dictionary" || node.shape === "Object") kinds.otherObjects = true;
  }
  return kinds;
}

// Reading an object may run code of the program: getters, the traps of a proxy, an iterator.
function heldAt(run: Run, holder: any, key: any, at: number): any {
  const value = holder[key];
  if (!isObject(value) || run.copies.has(value)) return value;
  const kinds = kindsDescribedAt(run, at);
  if (!kinds.arrays && !kinds.otherObjects) return value;
  const isArray = $isArray(value);
  if (!(isArray ? kinds.arrays : kinds.otherObjects)) return value;
  const copy = isArray ? $arrayFrom(value) : { ...value };
  run.copies.add(copy);
  define(holder, key, copy);
  return copy;
}

function heldMember(run: Run, holder: any, member: PlanMember): any {
  return $call<boolean>($Object.prototype.propertyIsEnumerable, holder, member.key)
    ? heldAt(run, holder, member.key, member.node)
    : undefined;
}

function heldRoot(run: Run, value: unknown): any {
  return heldAt(run, [value], 0, 0);
}

function appliesDefault(run: Run, at: number): boolean {
  const alternatives = new $Set([at]);
  for (const alternative of alternatives) {
    const node = run.nodes[alternative];
    if (node.default !== undefined) return true;
    const arms = node.arms ?? [];
    for (let i = 0; i < arms.length; i++) alternatives.add(arms[i]);
  }
  return false;
}

function startRemembering(run: Run): void {
  run.verdicts ??= new $Map();
}

function recall(memory: Map<object, unknown[]>, at: number, input: any): unknown {
  const known = isObject(input) ? memory.get(input) : undefined;
  if (known === undefined) return undefined;
  for (let i = 0; i < known.length; i += 2) {
    if (known[i] === at) return known[i + 1];
  }
  return undefined;
}

function remember(memory: Map<object, unknown[]>, at: number, input: any, verdict: unknown): void {
  if (!isObject(input)) return;
  const known = memory.get(input);
  if (known === undefined) memory.set(input, [at, verdict]);
  else known.push(at, verdict);
}

function buildArray(run: Run, node: PlanNode, input: any): any {
  if (!$isArray(input)) return run.refused;
  const result = $arrayFrom(input);
  if (!allHold(run, node, result)) return run.refused;
  for (let i = 0, length = result.length; i < length; i++) {
    const item = build(run, node.element!, heldAt(run, input, i, node.element!));
    if (item === run.refused) return run.refused;
    result[i] = item;
  }
  return result;
}

function buildTuple(run: Run, node: PlanNode, input: any): any {
  const elements = node.elements ?? [];
  if (!$isArray(input) || input.length !== elements.length) return run.refused;
  const result: any[] = [];
  for (let i = 0; i < elements.length; i++) {
    const item = build(run, elements[i], heldAt(run, input, i, elements[i]));
    if (item === run.refused) return run.refused;
    result.push(item);
  }
  return result;
}

function buildDictionary(run: Run, node: PlanNode, input: any): any {
  if (!isPlainObject(input)) return run.refused;
  const result: any = { ...input };
  const keys = $objectKeys(result);
  for (let i = 0; i < keys.length; i++) {
    const item = build(run, node.element!, heldAt(run, input, keys[i], node.element!));
    if (item === run.refused) return run.refused;
    if (item !== result[keys[i]]) define(result, keys[i], item);
  }
  return result;
}

function buildObject(run: Run, node: PlanNode, input: any): any {
  if (!isPlainObject(input)) return run.refused;
  const members = node.members ?? [];
  const result: any = { ...input };
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const memberValue = heldMember(run, input, member);
    if (memberValue === undefined && member.isOptional && !appliesDefault(run, member.node)) continue;
    const item = build(run, member.node, memberValue);
    if (item === run.refused) return run.refused;
    if (item === undefined) {
      if (member.mustBeOwn && !$hasOwn(result, member.key)) return run.refused;
    } else if (item !== memberValue) define(result, member.key, item);
  }
  if (node.undeclared !== "Rejected" && node.undeclared !== "Validated") return result;
  const keys = $objectKeys(result);
  for (let i = 0; i < keys.length; i++) {
    if (isDeclared(members, keys[i])) continue;
    if (node.undeclared === "Rejected") return run.refused;
    const item = build(run, node.undeclaredValue!, heldAt(run, input, keys[i], node.undeclaredValue!));
    if (item === run.refused) return run.refused;
    if (item !== result[keys[i]]) define(result, keys[i], item);
  }
  return result;
}

function buildUnion(run: Run, at: number, input: any): any {
  const node = run.nodes[at];
  const refused = run.refused;
  const remembers = node.remembers === true && isObject(input);
  if (remembers && run.verdicts !== undefined) {
    const known = recall(run.verdicts, at, input);
    if (known !== undefined) return known;
  }
  let arms = node.arms ?? [];
  let result: any = refused;
  const discriminant = isPlainObject(input) ? node.discriminant : undefined;
  if (discriminant !== undefined) {
    const tagIndex = discriminant.tags.indexOf(memberOf(input, discriminant));
    if (tagIndex >= 0) result = build(run, discriminant.tagged[tagIndex], input);
    if (tagIndex >= 0 && result === refused && remembers) startRemembering(run);
    arms = discriminant.untagged;
  }
  for (let i = 0; i < arms.length && result === refused; i++) {
    result = build(run, arms[i], input);
    if (result === refused && remembers) startRemembering(run);
  }
  if (result !== refused && !allHold(run, node, result)) result = refused;
  if (remembers && run.verdicts !== undefined) remember(run.verdicts, at, input, result);
  return result;
}

function build(run: Run, at: number, input: any): any {
  const node = run.nodes[at];
  const refused = run.refused;
  if (input === undefined && node.default !== undefined) input = node.default;
  let result: any = input;
  switch (node.shape) {
    case "Unknown":
      break;
    case "Never":
      return refused;
    case "Undefined":
      if (input !== undefined) return refused;
      break;
    case "Null":
      if (input !== null) return refused;
      break;
    case "AnyObject":
      if (!isObject(input)) return refused;
      break;
    case "Primitive":
      if (typeof input !== node.primitive) return refused;
      if (node.primitive === "number" && !$numberIsFinite(input)) return refused;
      break;
    case "BooleanLiteral":
    case "NumberLiteral":
    case "StringLiteral":
      if (input !== node.value) return refused;
      break;
    case "Array":
      return buildArray(run, node, input);
    case "Tuple":
      result = buildTuple(run, node, input);
      break;
    case "Dictionary":
      result = buildDictionary(run, node, input);
      break;
    case "Object":
      result = buildObject(run, node, input);
      break;
    case "Union":
      return buildUnion(run, at, input);
  }
  return result !== refused && allHold(run, node, result) ? result : refused;
}

function isMissing(input: any, member: PlanMember, value: any): boolean {
  return value === undefined && member.mustBeOwn && !$hasOwn(input, member.key);
}

function createIssue(path: any[], code: string, expected: string, value: any, message: string | undefined): any {
  const received = describeReceived(value);
  let defaultMessage = "Invalid input: expected " + expected;
  switch (code) {
    case "invalid_type":
    case "invalid_union":
      defaultMessage += ", received " + received;
      break;
    case "invalid_value":
      defaultMessage += ", received " + quoteReceived(value, received);
      break;
    case "unrecognized_keys":
      defaultMessage = "Unrecognized key: " + expected;
      break;
    case "too_small":
      defaultMessage = "Too small: expected " + expected;
      break;
    case "too_big":
      defaultMessage = "Too big: expected " + expected;
      break;
    case "not_multiple_of":
      defaultMessage = "Invalid number: must be a " + expected;
      break;
    case "invalid_pattern":
      code = "invalid_format";
      defaultMessage = "Invalid string: must match pattern " + expected.slice("string to match ".length);
      break;
  }
  return { path, code, expected, received, message: message === undefined ? defaultMessage : message };
}

function add(run: Run, issues: any[], issue: any): void {
  if (run.remainingIssues === 0) return;
  run.remainingIssues--;
  issues.push(issue);
}

function reportRules(run: Run, node: PlanNode, value: any, path: any[], issues: any[]): void {
  const rules = node.rules;
  if (rules === undefined) return;
  const isArray = $isArray(value);
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (holds(run, rule, value)) continue;
    let code = "invalid_format";
    let expected = "";
    switch (rule.rule) {
      case "Integer":
        code = "invalid_type";
        expected = "int";
        break;
      case "Minimum":
        code = "too_small";
        expected = "number to be >=" + rule.bound;
        break;
      case "Maximum":
        code = "too_big";
        expected = "number to be <=" + rule.bound;
        break;
      case "ExclusiveMinimum":
        code = "too_small";
        expected = "number to be >" + rule.bound;
        break;
      case "ExclusiveMaximum":
        code = "too_big";
        expected = "number to be <" + rule.bound;
        break;
      case "MultipleOf":
        code = "not_multiple_of";
        expected = "multiple of " + rule.divisor;
        break;
      case "MinimumLength":
        code = "too_small";
        expected =
          (isArray ? "array to have >=" : "string to have >=") + rule.length + (isArray ? " items" : " characters");
        break;
      case "MaximumLength":
        code = "too_big";
        expected =
          (isArray ? "array to have <=" : "string to have <=") + rule.length + (isArray ? " items" : " characters");
        break;
      case "Pattern":
        code = "invalid_pattern";
        expected = "string to match /" + rule.source + "/";
        break;
      case "Format":
        expected = rule.format!;
        break;
      case "Template":
        expected = node.text!;
        break;
      case "Message":
      case "DefaultNull":
      case "DefaultBoolean":
      case "DefaultNumber":
      case "DefaultString":
        continue;
    }
    add(run, issues, createIssue(path, code, expected, value, node.message));
  }
}

function withKey(path: any[], key: any): any[] {
  return [...path, key];
}

function isNearArm(arm: PlanNode, input: any): boolean {
  switch (arm.shape) {
    case "Primitive":
      return typeof input === arm.primitive && (arm.primitive !== "number" || $numberIsFinite(input));
    case "Array":
    case "Tuple":
      return $isArray(input);
    case "Dictionary":
    case "Object":
      return isPlainObject(input);
    case "Unknown":
    case "Never":
    case "Undefined":
    case "Null":
    case "AnyObject":
    case "BooleanLiteral":
    case "NumberLiteral":
    case "StringLiteral":
    case "Union":
      return false;
  }
}

function createOptionalArms(run: Run, undefinedArm: number, arms: number[]): number[] {
  const optionalArms = [undefinedArm];
  for (let i = 0; i < arms.length; i++) {
    if (run.nodes[arms[i]].shape !== "Undefined") optionalArms.push(arms[i]);
  }
  return optionalArms;
}

function optionalUnionOf(run: Run, at: number): number {
  const unions = (run.optionalUnions ??= new $Map());
  const known = unions.get(at);
  if (known !== undefined) return known;
  const nodes = run.nodes;
  const node = nodes[at];
  const isUnconstrainedUnion =
    node.shape === "Union" && node.rules === undefined && node.message === undefined && node.default === undefined;
  const undefinedArm = nodes.length;
  nodes.push({ shape: "Undefined" });
  const union: PlanNode = {
    shape: "Union",
    arms: createOptionalArms(run, undefinedArm, isUnconstrainedUnion ? (node.arms ?? []) : [at]),
  };
  if (isUnconstrainedUnion) {
    const discriminant = node.discriminant;
    if (discriminant !== undefined)
      union.discriminant = { ...discriminant, untagged: createOptionalArms(run, undefinedArm, discriminant.untagged) };
    union.remembers = node.remembers;
  }
  const unionAt = nodes.length;
  nodes.push(union);
  unions.set(at, unionAt);
  return unionAt;
}

function reportMembers(run: Run, node: PlanNode, input: any, path: any[], issues: any[]): void {
  const members = node.members ?? [];
  for (let i = 0; i < members.length && run.remainingIssues !== 0; i++) {
    const member = members[i];
    const value = heldMember(run, input, member);
    const memberPath = withKey(path, member.key);
    if (isMissing(input, member, value)) {
      const message = run.nodes[member.node].message;
      add(run, issues, createIssue(memberPath, "invalid_type", expectedOf(run, member.node), undefined, message));
    } else if (!member.isOptional) report(run, member.node, value, memberPath, issues);
    else if (value !== undefined) report(run, optionalUnionOf(run, member.node), value, memberPath, issues);
    else if (appliesDefault(run, member.node)) report(run, member.node, value, memberPath, issues);
  }
  const undeclaredValue =
    node.shape === "Dictionary" ? node.element : node.undeclared === "Validated" ? node.undeclaredValue : undefined;
  if ((undeclaredValue === undefined && node.undeclared !== "Rejected") || run.remainingIssues === 0) return;
  const keys = $objectKeys(input);
  for (let i = 0; i < keys.length && run.remainingIssues !== 0; i++) {
    const key = keys[i];
    if (isDeclared(members, key)) continue;
    if (undeclaredValue === undefined)
      add(run, issues, createIssue(path, "unrecognized_keys", $jsonStringify(key), input, node.message));
    else report(run, undeclaredValue, heldAt(run, input, key, undeclaredValue), withKey(path, key), issues);
  }
}

function report(run: Run, at: number, input: any, path: any[], issues: any[]): void {
  if (run.remainingIssues === 0) return;
  if (path.length > 8) return reportUnder(run, path, at, input, issues);
  const node = run.nodes[at];
  if (input === undefined && node.default !== undefined) input = node.default;
  let code = "invalid_type";
  let expected = "object";
  switch (node.shape) {
    case "Unknown":
      return;
    case "Never":
      expected = "never";
      break;
    case "Undefined":
      if (input === undefined) return;
      code = "invalid_value";
      expected = "undefined";
      break;
    case "Null":
      if (input === null) return;
      code = "invalid_value";
      expected = "null";
      break;
    case "AnyObject":
      if (isObject(input)) return;
      break;
    case "Primitive":
      if (isNearArm(node, input)) return reportRules(run, node, input, path, issues);
      expected = node.primitive!;
      break;
    case "BooleanLiteral":
    case "NumberLiteral":
    case "StringLiteral":
      if (input === node.value) return;
      code = "invalid_value";
      expected = $jsonStringify(node.value);
      break;
    case "Array":
      expected = "array";
      if (!$isArray(input)) break;
      reportRules(run, node, input, path, issues);
      for (let i = 0; i < input.length && run.remainingIssues !== 0; i++)
        report(run, node.element!, heldAt(run, input, i, node.element!), withKey(path, i), issues);
      return;
    case "Tuple": {
      const elements = node.elements ?? [];
      expected = "tuple";
      if (!$isArray(input) || input.length !== elements.length) break;
      for (let i = 0; i < elements.length; i++)
        report(run, elements[i], heldAt(run, input, i, elements[i]), withKey(path, i), issues);
      return;
    }
    case "Dictionary":
    case "Object":
      if (!isPlainObject(input)) break;
      return reportMembers(run, node, input, path, issues);
    case "Union":
      return node.remembers === true && isObject(input)
        ? reportOnce(run, at, input, path, issues)
        : reportUnion(run, at, input, path, issues);
  }
  add(run, issues, createIssue(path, code, expected, input, node.message));
}

function reportUnion(run: Run, at: number, input: any, path: any[], issues: any[]): void {
  const node = run.nodes[at];
  const before = run.remainingIssues;
  let nearArmIssues: any[] = [];
  let remainingAfterNearArm = before;
  let nearArmCount = 0;
  let arms = node.arms ?? [];
  const discriminant = isPlainObject(input) ? node.discriminant : undefined;
  let taggedArmIssues: any[] | undefined = undefined;
  let remainingAfterTaggedArm = before;
  if (discriminant !== undefined) {
    const tagIndex = discriminant.tags.indexOf(memberOf(input, discriminant));
    if (tagIndex >= 0) {
      taggedArmIssues = [];
      report(run, discriminant.tagged[tagIndex], input, path, taggedArmIssues);
      remainingAfterTaggedArm = run.remainingIssues;
      run.remainingIssues = before;
      if (taggedArmIssues.length === 0) return reportRules(run, node, input, path, issues);
    }
    arms = discriminant.untagged;
  }
  for (let i = 0; i < arms.length; i++) {
    const found: any[] = [];
    report(run, arms[i], input, path, found);
    const remaining = run.remainingIssues;
    run.remainingIssues = before;
    if (found.length === 0) return reportRules(run, node, input, path, issues);
    if (isNearArm(run.nodes[arms[i]], input)) {
      nearArmIssues = found;
      remainingAfterNearArm = remaining;
      nearArmCount++;
    }
  }
  if (taggedArmIssues !== undefined) {
    nearArmIssues = taggedArmIssues;
    remainingAfterNearArm = remainingAfterTaggedArm;
    nearArmCount = 1;
  }
  if (nearArmCount === 1) {
    for (let i = 0; i < nearArmIssues.length; i++) issues.push(nearArmIssues[i]);
    run.remainingIssues = remainingAfterNearArm;
    return;
  }
  if (nearArmCount === 0 && discriminant !== undefined) {
    const tagPath = withKey(path, discriminant.key);
    return add(
      run,
      issues,
      createIssue(tagPath, "invalid_value", discriminant.expected, memberOf(input, discriminant), node.message),
    );
  }
  add(
    run,
    issues,
    createIssue(path, nearArmCount > 1 ? "invalid_union" : "invalid_type", expectedOf(run, at), input, node.message),
  );
}

function reportOnce(run: Run, at: number, input: any, path: any[], issues: any[]): void {
  const memory = (run.reported ??= new $Map());
  let known: any = recall(memory, at, input);
  if (known === undefined) {
    const before = run.remainingIssues;
    run.remainingIssues = maxIssueCount();
    known = [[], 0];
    reportUnion(run, at, input, [], known[0]);
    known[1] = maxIssueCount() - run.remainingIssues;
    run.remainingIssues = before;
    remember(memory, at, input, known);
  }
  addUnder(run, path, known[0], known[1], issues);
}

function reportUnder(run: Run, path: any[], at: number, input: any, issues: any[]): void {
  const before = run.remainingIssues;
  const found: any[] = [];
  report(run, at, input, [], found);
  if (found.length !== 0) issues.push([path, found, before - run.remainingIssues]);
}

function addUnder(run: Run, path: any[], found: any[], count: number, issues: any[]): void {
  const taken = $min(count, run.remainingIssues);
  if (taken === 0) return;
  issues.push([path, found, taken]);
  run.remainingIssues -= taken;
}

function addWithWholePaths(found: any[], limit: number, path: any[], issues: any[]): void {
  const end = issues.length + limit;
  for (let i = 0; i < found.length && issues.length < end; i++) {
    const entry = found[i];
    if (!$isArray(entry)) {
      issues.push({ ...entry, path: [...path, ...entry.path] });
      continue;
    }
    const length = path.length;
    for (let j = 0; j < entry[0].length; j++) path.push(entry[0][j]);
    addWithWholePaths(entry[1], $min(entry[2], end - issues.length), path, issues);
    path.length = length;
  }
}

function issuesOf(run: Run, value: any): any[] {
  const found: any[] = [];
  report(run, 0, value, [], found);
  if (found.length === 0) add(run, found, createIssue([], "invalid_type", expectedOf(run, 0), value, undefined));
  const issues: any[] = [];
  addWithWholePaths(found, maxIssueCount(), [], issues);
  return issues;
}

function isIdentifier(key: string): boolean {
  for (let i = 0; i < key.length; i++) {
    const unit = key.charCodeAt(i);
    const isLetter = (unit >= 97 && unit <= 122) || (unit >= 65 && unit <= 90) || unit === 95 || unit === 36;
    if (!isLetter && (i === 0 || unit < 48 || unit > 57)) return false;
  }
  return key.length > 0;
}

function formatPath(path: any[]): string {
  let text = "";
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    if (typeof key === "string" && isIdentifier(key)) text += (text ? "." : "") + key;
    else text += "[" + $jsonStringify(key) + "]";
  }
  return text;
}

function withoutPrefix(message: string): string {
  const prefixes = ["Invalid input: ", "Too small: ", "Too big: ", "Invalid string: ", "Invalid number: "];
  for (let i = 0; i < prefixes.length; i++) {
    if (message.startsWith(prefixes[i])) return message.slice(prefixes[i].length);
  }
  return message;
}

function errorWith(issues: any[]): any {
  const first = issues[0];
  let summary = withoutPrefix(String(first.message));
  if (first.code === "unrecognized_keys" && summary.startsWith("Unrecognized key: "))
    summary = "unrecognized key " + first.expected;
  if (first.path.length) summary = formatPath(first.path) + ": " + summary;
  if (issues.length > 1) summary += " (and " + (issues.length - 1) + " more)";
  const error: any = new TypeError(summary);
  $putByValDirect(error, "issues", issues);
  return error;
}

export function validate(value: unknown): unknown {
  return value;
}

export function validateByPlan(value: unknown, plan: string): unknown {
  const run = createRun($jsonParse(plan));
  const held = heldRoot(run, value);
  const result = build(run, 0, held);
  if (result !== run.refused) return result;
  throw errorWith(issuesOf(run, held));
}

export function interpretNode(value: unknown, plan: string): [boolean, unknown] {
  const run = createRun($jsonParse(plan));
  const result = build(run, 0, heldRoot(run, value));
  return result === run.refused ? [false, undefined] : [true, result];
}

export function holdsRule(value: unknown, rule: string): boolean {
  return holds(createRun([]), $jsonParse(rule), value);
}

export function copyOwnProperties(value: object): object {
  return { ...value };
}
