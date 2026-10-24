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
  kind: number;
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
  describesArrays?: boolean;
  describesOtherObjects?: boolean;
  hasDefault?: boolean;
};

type Plan = PlanNode[];

// What is made of the text of a plan or of a rule, once. Reporting adds nodes for optional members.
interface Prepared {
  nodes: Plan;
  rule: PlanRule | undefined;
  optionalUnions: Map<number, number>;
}

// The engine's: what new RegExp(source).test(value) answers, and RegExp.$1 and its like are left as they are.
type MatchesPattern = (source: string, value: unknown) => boolean;

interface Run {
  nodes: Plan;
  refused: object;
  verdicts: Map<object, unknown[]> | undefined;
  remainingIssues: number;
  reported: Map<object, unknown[]> | undefined;
  optionalUnions: Map<number, number>;
  matchesPattern: MatchesPattern;
  // Undefined when the whole value is a copy that nobody else has. Else, for each private copy, what it was read from: the object of the value, or for an array its HeldArray.
  copies: Map<object, object> | undefined;
  // Something has looked at a part of the value and has not taken it: a private copy may hold private copies of parts that the next to look at it does not describe.
  isLookedAtAgain: boolean;
  remainingHoles: number;
}

// The private copy of an array holds the elements that have been read so far.
interface HeldArray {
  source: any;
  length: number;
}

// The number of the case in holds(). A rule that tests nothing has none.
function kindOfRule(rule: PlanRule["rule"]): number {
  switch (rule) {
    case "Integer":
      return 0;
    case "Minimum":
      return 1;
    case "Maximum":
      return 2;
    case "ExclusiveMinimum":
      return 3;
    case "ExclusiveMaximum":
      return 4;
    case "MultipleOf":
      return 5;
    case "MinimumLength":
      return 6;
    case "MaximumLength":
      return 7;
    case "Pattern":
      return 8;
    case "Format":
      return 9;
    case "Template":
      return 10;
    case "Message":
    case "DefaultNull":
    case "DefaultBoolean":
    case "DefaultNumber":
    case "DefaultString":
      return 11;
    default:
      throw new TypeError("a validation plan holds a rule that is not known: " + rule);
  }
}

function createRule(parsed: any): PlanRule {
  return {
    rule: parsed.rule,
    kind: kindOfRule(parsed.rule),
    bound: parsed.bound,
    divisor: parsed.divisor,
    length: parsed.length,
    format: parsed.format,
    source: parsed.source,
    texts: parsed.texts,
    placeholders: parsed.placeholders,
  };
}

function createRules(parsed: any[] | undefined): PlanRule[] | undefined {
  if (parsed === undefined) return undefined;
  const rules: PlanRule[] = [];
  for (let i = 0; i < parsed.length; i++) rules.push(createRule(parsed[i]));
  return rules;
}

function createMembers(parsed: any[] | undefined): PlanMember[] | undefined {
  if (parsed === undefined) return undefined;
  const members: PlanMember[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const member = parsed[i];
    members.push({ key: member.key, node: member.node, isOptional: member.isOptional, mustBeOwn: member.mustBeOwn });
  }
  return members;
}

// The parser's objects are read by name. These have the fields of their types.
function createNodes(parsed: any[]): Plan {
  const nodes: Plan = [];
  for (let i = 0; i < parsed.length; i++) {
    const node = parsed[i];
    nodes.push({
      shape: node.shape,
      primitive: node.primitive,
      value: node.value,
      element: node.element,
      elements: node.elements,
      arms: node.arms,
      members: createMembers(node.members),
      undeclared: node.undeclared,
      undeclaredValue: node.undeclaredValue,
      discriminant: node.discriminant,
      remembers: node.remembers,
      rules: createRules(node.rules),
      message: node.message,
      default: node.default,
      text: node.text,
      describesArrays: undefined,
      describesOtherObjects: undefined,
      hasDefault: undefined,
    });
  }
  return nodes;
}

// A library file has no variables: the engine keeps the Map, and compiled code hands it to every function here that takes a text.
function preparedUnder(name: string, preparedByText: Map<string, any>): any {
  return $call<any>($Map.prototype.get, preparedByText, name);
}

function prepare(text: string, preparedByText: Map<string, Prepared>): Prepared {
  const known: Prepared | undefined = preparedUnder(text, preparedByText);
  if (known !== undefined) return known;
  const parsed = $jsonParse(text);
  const isPlan = $isArray(parsed);
  const prepared = {
    nodes: isPlan ? createNodes(parsed) : [],
    rule: isPlan ? undefined : createRule(parsed),
    optionalUnions: new $Map(),
  };
  $call<unknown>($Map.prototype.set, preparedByText, text, prepared);
  return prepared;
}

function maxIssueCount(): number {
  return 100;
}

// In all the arrays of one value.
function maxHoleCount(): number {
  return 65536;
}

function createRun(plan: string, preparedByText: Map<string, any>, isCopy: boolean): Run {
  const prepared = prepare(plan, preparedByText);
  return {
    nodes: prepared.nodes,
    refused: {},
    verdicts: undefined,
    remainingIssues: maxIssueCount(),
    reported: undefined,
    optionalUnions: prepared.optionalUnions,
    matchesPattern: preparedUnder("matchesPattern", preparedByText),
    copies: isCopy ? undefined : new $Map(),
    isLookedAtAgain: false,
    remainingHoles: maxHoleCount(),
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

function matchesPlaceholder(matchesPattern: MatchesPattern, kind: string, part: string): boolean {
  if (kind === "s") return true;
  if (kind === "n") return part !== "" && $numberIsFinite(+part);
  return matchesPattern("^-?(?:0|[1-9][0-9]*|0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)$", part);
}

function matchesTemplate(
  matchesPattern: MatchesPattern,
  texts: string[],
  placeholders: string,
  value: string,
): boolean {
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
    if (partEnd < 0 || next > end) return false;
    if (!matchesPlaceholder(matchesPattern, placeholders[i - 1], value.slice(position, partEnd))) return false;
    position = next;
  }
  return matchesPlaceholder(matchesPattern, placeholders[last - 1], value.slice(position, end));
}

// A surrogate pair is one character. A surrogate without its other half is one too.
export function countCodePoints(text: string): number {
  const units = text.length;
  let count = units;
  for (let i = 1; i < units; i++) {
    if ((text.charCodeAt(i) & 0xfc00) !== 0xdc00 || (text.charCodeAt(i - 1) & 0xfc00) !== 0xd800) continue;
    count--;
    i++;
  }
  return count;
}

// A string has at most as many characters as UTF-16 units, and at least half as many.
function hasAtLeast(value: any, length: number): boolean {
  const units = value.length;
  if (units < length) return false;
  return typeof value !== "string" || units >= 2 * length - 1 || countCodePoints(value) >= length;
}

function hasAtMost(value: any, length: number): boolean {
  return value.length <= length || (typeof value === "string" && countCodePoints(value) <= length);
}

function holds(matchesPattern: MatchesPattern, rule: PlanRule, value: any): boolean {
  switch (rule.kind) {
    case 0:
      return $numberIsInteger(value);
    case 1:
      return value >= rule.bound!;
    case 2:
      return value <= rule.bound!;
    case 3:
      return value > rule.bound!;
    case 4:
      return value < rule.bound!;
    case 5:
      return value % rule.divisor! === 0;
    case 6:
      return hasAtLeast(value, rule.length!);
    case 7:
      return hasAtMost(value, rule.length!);
    case 8:
      return matchesPattern(rule.source!, value);
    case 9:
      if (rule.source) return matchesPattern(rule.source, value);
      if (rule.format !== "url")
        throw new TypeError("a validation plan holds a format that is not known: " + rule.format);
      return $urlCanParse(value);
    case 10:
      return matchesTemplate(matchesPattern, rule.texts!, rule.placeholders!, value);
    case 11:
      return true;
    default:
      throw new TypeError("a validation plan holds a rule that is not known: " + rule.rule);
  }
}

function allHold(run: Run, node: PlanNode, value: any): boolean {
  const rules = node.rules;
  if (rules === undefined) return true;
  for (let i = 0; i < rules.length; i++) {
    if (!holds(run.matchesPattern, rules[i], value)) return false;
  }
  return true;
}

// The rules of an array are about its length.
function holdsOfLength(rule: PlanRule, length: number): boolean {
  return rule.kind === 6 ? length >= rule.length! : rule.kind !== 7 || length <= rule.length!;
}

function allHoldOfLength(node: PlanNode, length: number): boolean {
  const rules = node.rules;
  if (rules === undefined) return true;
  for (let i = 0; i < rules.length; i++) {
    if (!holdsOfLength(rules[i], length)) return false;
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

function describes(run: Run, at: number, isArray: boolean): boolean {
  const described = run.nodes[at];
  if (described.describesArrays === undefined) {
    let describesArrays = false;
    let describesOtherObjects = false;
    const alternatives = [at];
    for (let i = 0; i < alternatives.length; i++) {
      const node = run.nodes[alternatives[i]];
      const arms = node.shape === "Union" ? (node.arms ?? []) : [];
      for (let j = 0; j < arms.length; j++) addOnce(alternatives, arms[j]);
      if (node.shape === "Array" || node.shape === "Tuple") describesArrays = true;
      else if (node.shape === "Dictionary" || node.shape === "Object") describesOtherObjects = true;
    }
    described.describesOtherObjects = describesOtherObjects;
    described.describesArrays = describesArrays;
  }
  return (isArray ? described.describesArrays : described.describesOtherObjects) === true;
}

function toLength(value: any): number {
  const length = +value;
  if (!(length > 0)) return 0;
  return length >= 9007199254740991 ? 9007199254740991 : length - (length % 1);
}

// An array says how long it is, and an array without a single element can say 4,294,967,295. So nothing is done once for each index up to the length:
// the length is read first, and an element when somebody asks for it.
function holdArray(run: Run, value: any): any[] {
  const copy: any[] = [];
  run.copies!.set(copy, { source: value, length: toLength(value.length) });
  return copy;
}

// Undefined for an array that is read to the end.
function unreadOf(run: Run, input: any[]): HeldArray | undefined {
  const held = run.copies === undefined ? undefined : (run.copies.get(input) as HeldArray | undefined);
  return held === undefined || input.length === held.length ? undefined : held;
}

// Reads the next element into the copy. A hole is read as undefined. False if the arrays of the value have too many holes.
function tryReadNext(run: Run, input: any[], unread: HeldArray): boolean {
  const index = input.length;
  const element = unread.source[index];
  if (element === undefined && !$hasOwn(unread.source, index)) {
    if (run.remainingHoles === 0) return false;
    run.remainingHoles--;
  }
  input.push(element);
  return true;
}

function readNext(run: Run, input: any[], unread: HeldArray): void {
  if (!tryReadNext(run, input, unread))
    throw new RangeError("The arrays of the value have more than " + maxHoleCount() + " holes");
}

function heldElement(run: Run, input: any[], unread: HeldArray | undefined, index: number, at: number): any {
  if (unread !== undefined && index >= input.length) readNext(run, input, unread);
  return heldAt(run, input, index, at);
}

// Reading an object may run code of the program: getters, the traps of a proxy. So it is read once, into a private copy that all arms of a union look at.
// No result holds a private copy: sourceOf() and putSourcesBack() are the two ways by which a part that is not described goes into a result.
function heldAt(run: Run, holder: any, key: any, at: number): any {
  const value = holder[key];
  const copies = run.copies;
  if (copies === undefined || !isObject(value) || copies.has(value)) return value;
  // What the type says nothing about is asked nothing.
  if (!describes(run, at, true) && !describes(run, at, false)) return value;
  const isArray = $isArray(value);
  if (!describes(run, at, isArray)) return value;
  let copy: any;
  if (isArray) copy = holdArray(run, value);
  else copies.set((copy = { ...value }), value);
  define(holder, key, copy);
  return copy;
}

// What the type does not describe is handed on as it is: the object of the value.
function sourceOf(run: Run, input: any): any {
  const held = run.copies === undefined || !isObject(input) ? undefined : run.copies.get(input);
  return held === undefined ? input : $isArray(input) ? (held as HeldArray).source : held;
}

// A result begins as all that a private copy of an object holds. It holds them as they were read.
function putSourcesBack(run: Run, result: any): void {
  const keys = $objectKeys(result);
  for (let i = 0; i < keys.length; i++) {
    const held = result[keys[i]];
    const source = sourceOf(run, held);
    if (source !== held) define(result, keys[i], source);
  }
}

// The holder is a copy that heldAt made: what it has of its own is enumerable.
function heldMember(run: Run, holder: any, member: PlanMember): any {
  return $hasOwn(holder, member.key) ? heldAt(run, holder, member.key, member.node) : undefined;
}

function heldRoot(run: Run, value: unknown): any {
  return heldAt(run, [value], 0, 0);
}

function findDefault(run: Run, at: number): boolean {
  const alternatives = new $Set([at]);
  for (const alternative of alternatives) {
    const node = run.nodes[alternative];
    if (node.default !== undefined) return true;
    const arms = node.arms ?? [];
    for (let i = 0; i < arms.length; i++) alternatives.add(arms[i]);
  }
  return false;
}

function appliesDefault(run: Run, at: number): boolean {
  return (run.nodes[at].hasDefault ??= findDefault(run, at));
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
  const unread = unreadOf(run, input);
  const length = unread === undefined ? input.length : unread.length;
  if (!allHoldOfLength(node, length)) return run.refused;
  const result: any[] = [];
  for (let i = 0; i < length; i++) {
    const item = build(run, node.element!, heldElement(run, input, unread, i, node.element!));
    if (item === run.refused) return run.refused;
    result.push(item);
  }
  return result;
}

function buildTuple(run: Run, node: PlanNode, input: any): any {
  const elements = node.elements ?? [];
  if (!$isArray(input)) return run.refused;
  const unread = unreadOf(run, input);
  if ((unread === undefined ? input.length : unread.length) !== elements.length) return run.refused;
  const result: any[] = [];
  for (let i = 0; i < elements.length; i++) {
    const item = build(run, elements[i], heldElement(run, input, unread, i, elements[i]));
    if (item === run.refused) return run.refused;
    result.push(item);
  }
  return result;
}

function buildDictionary(run: Run, node: PlanNode, input: any): any {
  if (!isPlainObject(input)) return run.refused;
  const result: any = { ...input };
  if (run.isLookedAtAgain) putSourcesBack(run, result);
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
  if (run.isLookedAtAgain) putSourcesBack(run, result);
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
    if (tagIndex >= 0 && result === refused) run.isLookedAtAgain = true;
    if (tagIndex >= 0 && result === refused && remembers) startRemembering(run);
    arms = discriminant.untagged;
  }
  for (let i = 0; i < arms.length && result === refused; i++) {
    result = build(run, arms[i], input);
    if (result === refused) run.isLookedAtAgain = true;
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
      result = sourceOf(run, input);
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
      result = sourceOf(run, input);
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

function createIssue(path: any[], code: string, expected: string, value: any, ownWords: string | undefined): any {
  const received = describeReceived(value);
  let message = "must be " + expected;
  switch (code) {
    case "invalid_type":
    case "invalid_union":
      message += ", received " + received;
      break;
    case "invalid_value":
      message += ", received " + quoteReceived(value, received);
      break;
    case "unrecognized_keys":
      message = "must not have key " + expected;
      break;
    case "too_small":
    case "too_big":
      message = "must " + expected.slice(expected.indexOf(" to ") + " to ".length);
      break;
    case "not_multiple_of":
      message = "must be a " + expected;
      break;
    case "invalid_pattern":
      code = "invalid_format";
      message = "must match pattern " + expected.slice("string to match ".length);
      break;
  }
  return { path, code, expected, received, message: ownWords ?? message, isInOwnWords: ownWords !== undefined };
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
  const unread = isArray ? unreadOf(run, value) : undefined;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (unread === undefined ? holds(run.matchesPattern, rule, value) : holdsOfLength(rule, unread.length)) continue;
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
  const unions = run.optionalUnions;
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

// There is nothing to report about such a value, so it needs no path.
function isRightPrimitive(run: Run, at: number, value: any): boolean {
  const node = run.nodes[at];
  return node.shape === "Primitive" && isNearArm(node, value) && allHold(run, node, value);
}

function reportMembers(run: Run, node: PlanNode, input: any, path: any[], issues: any[]): void {
  const members = node.members ?? [];
  for (let i = 0; i < members.length && run.remainingIssues !== 0; i++) {
    const member = members[i];
    const value = heldMember(run, input, member);
    if (isRightPrimitive(run, member.node, value)) continue;
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
    case "Array": {
      expected = "array";
      if (!$isArray(input)) break;
      reportRules(run, node, input, path, issues);
      const unread = unreadOf(run, input);
      const length = unread === undefined ? input.length : unread.length;
      for (let i = 0; i < length && run.remainingIssues !== 0; i++) {
        if (unread !== undefined && i >= input.length && !tryReadNext(run, input, unread)) return;
        const item = heldAt(run, input, i, node.element!);
        if (!isRightPrimitive(run, node.element!, item)) report(run, node.element!, item, withKey(path, i), issues);
      }
      return;
    }
    case "Tuple": {
      const elements = node.elements ?? [];
      expected = "tuple";
      if (!$isArray(input)) break;
      const unread = unreadOf(run, input);
      if ((unread === undefined ? input.length : unread.length) !== elements.length) break;
      for (let i = 0; i < elements.length; i++) {
        if (unread !== undefined && i >= input.length && !tryReadNext(run, input, unread)) return;
        report(run, elements[i], heldAt(run, input, i, elements[i]), withKey(path, i), issues);
      }
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

function addWithWholePaths(found: any[], limit: number, path: any[], issues: any[], areInOwnWords: boolean[]): void {
  const end = issues.length + limit;
  for (let i = 0; i < found.length && issues.length < end; i++) {
    const entry = found[i];
    if (!$isArray(entry)) {
      const { isInOwnWords, ...issue } = entry;
      issues.push({ ...issue, path: [...path, ...entry.path] });
      areInOwnWords.push(isInOwnWords);
      continue;
    }
    const length = path.length;
    for (let j = 0; j < entry[0].length; j++) path.push(entry[0][j]);
    addWithWholePaths(entry[1], $min(entry[2], end - issues.length), path, issues, areInOwnWords);
    path.length = length;
  }
}

function findIssues(run: Run, value: any): any[] {
  const found: any[] = [];
  report(run, 0, value, [], found);
  return found;
}

function messageAndIssuesOf(found: any[]): [string, any[]] {
  const issues: any[] = [];
  const areInOwnWords: boolean[] = [];
  addWithWholePaths(found, maxIssueCount(), [], issues, areInOwnWords);
  return [messageOf(issues, areInOwnWords[0]), issues];
}

function errorOf(found: any[]): any {
  const [message, issues] = messageAndIssuesOf(found);
  const error: any = new TypeError(message);
  $putByValDirect(error, "issues", issues);
  return error;
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

function messageOf(issues: any[], isInOwnWords: boolean): string {
  const first = issues[0];
  const path = formatPath(first.path);
  const rest = issues.length > 1 ? "and " + (issues.length - 1) + " more" : "";
  if (!isInOwnWords) return (path || "value") + " " + first.message + (rest && " (" + rest + ")");
  const place = path && "at " + path;
  const aside = place && rest ? place + ", " + rest : place || rest;
  return first.message + (aside && " (" + aside + ")");
}

function addIssueOfRoot(run: Run, found: any[], value: any): void {
  add(run, found, createIssue([], "invalid_type", expectedOf(run, 0), value, undefined));
}

// Most errors are caught and never read. The engine copies a value that it can copy without running code of the program. The message and the issues are made of the copy when one of them is first read.
function tryDeferReport(value: unknown, plan: string, prepared: Map<string, any>): unknown {
  const error = new TypeError();
  const isDeferred = preparedUnder("deferReport", prepared)(error, value, (copy: unknown) => {
    const run = createRun(plan, prepared, true);
    const found = findIssues(run, copy);
    if (found.length === 0) addIssueOfRoot(run, found, copy);
    return messageAndIssuesOf(found);
  });
  return isDeferred ? error : undefined;
}

export function validate(value: unknown): unknown {
  return value;
}

// Compiled code that has refused the value says so, and nothing is built.
export function validateByPlan(
  value: unknown,
  plan: string,
  isRefused: boolean,
  prepared: Map<string, Prepared>,
): unknown {
  if (isRefused) {
    const error = tryDeferReport(value, plan, prepared);
    if (error !== undefined) throw error;
  }
  const run = createRun(plan, prepared, false);
  const held = heldRoot(run, value);
  if (isRefused) {
    const found = findIssues(run, held);
    if (found.length !== 0) throw errorOf(found);
    run.isLookedAtAgain = true;
  }
  const result = build(run, 0, held);
  if (result !== run.refused) return result;
  const found = findIssues(run, held);
  if (found.length === 0) addIssueOfRoot(run, found, held);
  throw errorOf(found);
}

export function interpretNode(value: unknown, plan: string, prepared: Map<string, Prepared>): [boolean, unknown] {
  const run = createRun(plan, prepared, false);
  const result = build(run, 0, heldRoot(run, value));
  return result === run.refused ? [false, undefined] : [true, result];
}

export function holdsRule(value: unknown, rule: string, prepared: Map<string, any>): boolean {
  return holds(preparedUnder("matchesPattern", prepared), prepare(rule, prepared).rule!, value);
}

export function copyOwnProperties(value: object): object {
  return { ...value };
}
