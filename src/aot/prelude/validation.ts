declare function $call<R>(f: unknown, thisArg: unknown, ...args: unknown[]): R;
declare function $getOwnPropertySymbols(object: object): symbol[];
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
    | "DefaultString"
    | "UniqueItems"
    | "Contains"
    | "Not"
    | "If"
    | "ExactlyOne"
    | "Every"
    | "PatternMembers"
    | "MemberNames"
    | "MinimumMembers"
    | "MaximumMembers"
    | "DependentMembers"
    | "DependentNode";
  kind: number;
  bound?: number;
  divisor?: number;
  // A divisor that is not whole, as it is written: whole digits times a power of ten.
  divisorDigits?: number;
  divisorExponent?: number;
  length?: number;
  format?: string;
  source?: string;
  isUnicode?: boolean;
  texts?: string[];
  placeholders?: string;
  node?: number;
  minimum?: number;
  maximum?: number;
  condition?: number;
  then?: number;
  otherwise?: number;
  nodes?: number[];
  sources?: string[];
  count?: number;
  key?: string;
  names?: string[];
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
  required?: number;
  rest?: number;
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

// The engine's: it searches the text as new RegExp(source, isUnicode ? "u" : "").test(text) does, and RegExp.$1 and its like are left as they are.
// It takes the steps that may still be spent. Where the text matches it answers the steps that are left, and where it does not, -1 less those. A search that needs more steps throws, or answers no number.
type MatchesPattern = (source: string, text: string, isUnicode: boolean, remainingSteps: number) => number | undefined;

// What all tests of one call share.
interface Tests {
  matchesPattern: MatchesPattern;
  // Each of many keys may stay below a limit of its own, so there is one sum.
  remainingSteps: number;
  // Set for what no test can judge: a name that a format cannot read, a function among items that are compared.
  // The node that refuses it may stand under Not, so the whole value is refused.
  mustRefuse: boolean;
}

interface Run {
  nodes: Plan;
  tests: Tests;
  refused: object;
  // False while a rule asks whether a node accepts a value: nothing is made and no default is filled.
  isBuilding: boolean;
  verdicts: Map<object, unknown[]> | undefined;
  remainingIssues: number;
  // A rule reports by the nodes it names. Nodes that name one another could do so without end and without an issue.
  remainingReportsByRules: number;
  reported: Map<object, unknown[]> | undefined;
  optionalUnions: Map<number, number>;
  // Undefined when the whole value is a copy that nobody else has. Else, for each private copy, what it was read from: the object of the value, or for an array its HeldArray.
  // A copy that a rule has looked at is kept: it stands for itself, and the result holds it, so that what comes back is what was judged.
  copies: Map<object, object> | undefined;
  keptArrays: any[][];
  // Something has looked at a part of the value and has not taken it: a private copy may hold private copies of parts that the next to look at it does not describe.
  isLookedAtAgain: boolean;
  // For each private copy of an object that has enumerable symbols among its own keys: those symbols.
  symbolKeys: Map<object, symbol[]> | undefined;
  // Whether a copy holds only what a JSON text can say.
  saysOnlyJSON: Map<object, boolean>;
  remainingHoles: number;
  remainingVisits: number;
  // Where nothing is built, each node answers once for each copy. A copy without issues is looked through once.
  acceptances: Map<object, unknown[]>;
  withoutIssues: Map<object, unknown[]>;
  // Equal values have one number. An array or an object is written with the numbers of what it holds, so its writing is as long as it has items or members.
  numberOfWriting: Map<string, number>;
  writingCount: number;
  numberOfObject: Map<object, number>;
}

// The private copy of an array holds the elements that have been read so far.
interface HeldArray {
  source: any;
  length: number;
  isKept: boolean;
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
    case "UniqueItems":
      return 12;
    case "Contains":
      return 13;
    case "Not":
      return 14;
    case "If":
      return 15;
    case "ExactlyOne":
      return 16;
    case "Every":
      return 17;
    case "PatternMembers":
      return 18;
    case "MemberNames":
      return 19;
    case "MinimumMembers":
      return 20;
    case "MaximumMembers":
      return 21;
    case "DependentMembers":
      return 22;
    case "DependentNode":
      return 23;
    default:
      throw new TypeError("Unknown rule in validation plan: " + rule);
  }
}

// These read the elements or the members of the value, or hand it to other nodes. The others test a primitive or a length.
function looksInside(rule: PlanRule): boolean {
  return rule.kind > 11;
}

function isCount(operand: unknown): boolean {
  return $numberIsInteger(operand) && (operand as number) >= 0;
}

function areCounts(operand: unknown): boolean {
  if (!$isArray(operand)) return false;
  for (let i = 0; i < operand.length; i++) {
    if (!isCount(operand[i])) return false;
  }
  return true;
}

function areTexts(operand: unknown): boolean {
  if (!$isArray(operand)) return false;
  for (let i = 0; i < operand.length; i++) {
    if (typeof operand[i] !== "string") return false;
  }
  return true;
}

function isAbsentOr(isRight: boolean, operand: unknown): boolean {
  return operand === undefined || isRight;
}

function isFormat(operand: unknown): boolean {
  return [
    "url",
    "regex",
    "json-pointer",
    "relative-json-pointer",
    "date-time",
    "date",
    "time",
    "duration",
    "email",
    "hostname",
    "ipv4",
    "ipv6",
    "uri",
    "uri-reference",
    "uuid",
  ].includes(operand as string);
}

function arePlaceholders(operand: unknown): boolean {
  if (typeof operand !== "string" || operand === "") return false;
  for (let i = 0; i < operand.length; i++) {
    if (operand[i] !== "s" && operand[i] !== "n" && operand[i] !== "b") return false;
  }
  return true;
}

function operandsOf(kind: number): string[] {
  switch (kind) {
    case 0:
    case 11:
    case 12:
      return ["rule"];
    case 1:
    case 2:
    case 3:
    case 4:
      return ["rule", "bound"];
    case 5:
      return ["rule", "divisor"];
    case 6:
    case 7:
      return ["rule", "length"];
    case 8:
      return ["rule", "source", "unicode"];
    case 9:
      return ["rule", "format"];
    case 10:
      return ["rule", "texts", "placeholders"];
    case 13:
      return ["rule", "node", "minimum", "maximum"];
    case 14:
    case 19:
      return ["rule", "node"];
    case 15:
      return ["rule", "condition", "then", "otherwise"];
    case 16:
    case 17:
      return ["rule", "nodes"];
    case 18:
      return ["rule", "sources", "nodes"];
    case 20:
    case 21:
      return ["rule", "count"];
    case 22:
      return ["rule", "key", "names"];
    case 23:
      return ["rule", "key", "node"];
    default:
      throw new TypeError("Unknown kind of rule in validation plan: " + kind);
  }
}

function hasItsOperands(rule: PlanRule): boolean {
  switch (rule.kind) {
    case 0:
    case 11:
    case 12:
      return true;
    case 1:
    case 2:
    case 3:
    case 4:
      return typeof rule.bound === "number";
    case 5:
      return typeof rule.divisor === "number" && isAbsentOr(rule.divisorDigits! < 4503599627370496, rule.divisorDigits);
    case 6:
    case 7:
      return isCount(rule.length);
    case 8:
      return typeof rule.source === "string" && isAbsentOr(typeof rule.isUnicode === "boolean", rule.isUnicode);
    case 9:
      return isFormat(rule.format);
    case 10:
      return (
        areTexts(rule.texts) &&
        arePlaceholders(rule.placeholders) &&
        rule.texts!.length === rule.placeholders!.length + 1
      );
    case 13:
      return isCount(rule.node) && isCount(rule.minimum) && isAbsentOr(isCount(rule.maximum), rule.maximum);
    case 14:
    case 19:
      return isCount(rule.node);
    case 15:
      return isCount(rule.condition) && isCount(rule.then) && isCount(rule.otherwise);
    case 16:
    case 17:
      return areCounts(rule.nodes);
    case 18:
      return areTexts(rule.sources) && areCounts(rule.nodes) && rule.sources!.length === rule.nodes!.length;
    case 20:
    case 21:
      return isCount(rule.count);
    case 22:
      return typeof rule.key === "string" && areTexts(rule.names);
    case 23:
      return typeof rule.key === "string" && isCount(rule.node);
    default:
      throw new TypeError("Unknown kind of rule in validation plan: " + rule.kind);
  }
}

// The parser's objects inherit. A part that the text leaves out is not looked for in what they inherit from.
function partOf(parsed: any, name: string): any {
  return $hasOwn(parsed, name) ? parsed[name] : undefined;
}

// A part that is not known may narrow what is accepted, so none is left unread.
function ensureHasOnly(parsed: any, names: string[]): void {
  const keys = $objectKeys(parsed);
  for (let i = 0; i < keys.length; i++) {
    if (!names.includes(keys[i])) throw new TypeError("Unknown key in validation plan: " + $jsonStringify(keys[i]));
  }
}

function createRule(parsed: any): PlanRule {
  const kind = kindOfRule(partOf(parsed, "rule"));
  ensureHasOnly(parsed, operandsOf(kind));
  const divisor = partOf(parsed, "divisor");
  const isFraction = $numberIsFinite(divisor) && !$numberIsInteger(divisor);
  const writtenDivisor = isFraction ? writeAsDecimal(divisor < 0 ? -divisor : divisor) : undefined;
  const rule: PlanRule = {
    rule: parsed.rule,
    kind,
    bound: partOf(parsed, "bound"),
    divisor,
    divisorDigits: writtenDivisor === undefined ? undefined : +writtenDivisor[0],
    divisorExponent: writtenDivisor === undefined ? undefined : writtenDivisor[1],
    length: partOf(parsed, "length"),
    format: partOf(parsed, "format"),
    source: partOf(parsed, "source"),
    isUnicode: partOf(parsed, "unicode"),
    texts: partOf(parsed, "texts"),
    placeholders: partOf(parsed, "placeholders"),
    node: partOf(parsed, "node"),
    minimum: partOf(parsed, "minimum"),
    maximum: partOf(parsed, "maximum"),
    condition: partOf(parsed, "condition"),
    then: partOf(parsed, "then"),
    otherwise: partOf(parsed, "otherwise"),
    nodes: partOf(parsed, "nodes"),
    sources: partOf(parsed, "sources"),
    count: partOf(parsed, "count"),
    key: partOf(parsed, "key"),
    names: partOf(parsed, "names"),
  };
  if (!hasItsOperands(rule)) throw new TypeError("Invalid operand of rule in validation plan: " + rule.rule);
  return rule;
}

function ensureIsList(parsed: unknown): void {
  if (!$isArray(parsed)) throw new TypeError("Expected validation plan to be an array");
}

function createRules(parsed: any[] | undefined): PlanRule[] | undefined {
  if (parsed === undefined) return undefined;
  ensureIsList(parsed);
  const rules: PlanRule[] = [];
  for (let i = 0; i < parsed.length; i++) rules.push(createRule(parsed[i]));
  return rules;
}

function createMembers(parsed: any[] | undefined): PlanMember[] | undefined {
  if (parsed === undefined) return undefined;
  ensureIsList(parsed);
  const members: PlanMember[] = [];
  for (let i = 0; i < parsed.length; i++) {
    ensureHasOnly(parsed[i], ["key", "node", "isOptional", "mustBeOwn"]);
    const member: PlanMember = {
      key: partOf(parsed[i], "key"),
      node: partOf(parsed[i], "node"),
      isOptional: partOf(parsed[i], "isOptional"),
      mustBeOwn: partOf(parsed[i], "mustBeOwn"),
    };
    if (
      typeof member.key !== "string" ||
      !isCount(member.node) ||
      typeof member.isOptional !== "boolean" ||
      typeof member.mustBeOwn !== "boolean"
    )
      throw new TypeError("Invalid member in validation plan");
    members.push(member);
  }
  return members;
}

function createDiscriminant(parsed: any): PlanDiscriminant | undefined {
  if (parsed === undefined) return undefined;
  ensureHasOnly(parsed, ["key", "tags", "tagged", "untagged", "expected"]);
  const discriminant: PlanDiscriminant = {
    key: partOf(parsed, "key"),
    tags: partOf(parsed, "tags"),
    tagged: partOf(parsed, "tagged"),
    untagged: partOf(parsed, "untagged"),
    expected: partOf(parsed, "expected"),
  };
  if (
    typeof discriminant.key !== "string" ||
    !$isArray(discriminant.tags) ||
    !areCounts(discriminant.tagged) ||
    !areCounts(discriminant.untagged) ||
    discriminant.tags.length !== discriminant.tagged.length ||
    typeof discriminant.expected !== "string"
  )
    throw new TypeError("Invalid discriminant in validation plan");
  return discriminant;
}

function hasPatternMembers(node: PlanNode): boolean {
  const rules = node.rules ?? [];
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].kind === 18) return true;
  }
  return false;
}

function hasItsParts(node: PlanNode): boolean {
  switch (node.shape) {
    case "Unknown":
    case "Never":
    case "Undefined":
    case "Null":
    case "AnyObject":
      return true;
    case "Primitive":
      return (
        node.primitive === "string" ||
        node.primitive === "number" ||
        node.primitive === "boolean" ||
        node.primitive === "bigint"
      );
    case "BooleanLiteral":
      return typeof node.value === "boolean";
    case "NumberLiteral":
      return $numberIsFinite(node.value);
    case "StringLiteral":
      return typeof node.value === "string";
    case "Array":
      return isCount(node.element);
    case "Tuple":
      return (
        isAbsentOr(areCounts(node.elements), node.elements) &&
        isAbsentOr(isCount(node.required), node.required) &&
        isAbsentOr(isCount(node.rest), node.rest)
      );
    // Every key of a dictionary holds its value type, also one that a pattern names: the two together say two things of one key.
    case "Dictionary":
      return isCount(node.element) && !hasPatternMembers(node);
    case "Object":
      return node.undeclared === "Validated"
        ? isCount(node.undeclaredValue)
        : (node.undeclared === "Allowed" || node.undeclared === "Rejected") && node.undeclaredValue === undefined;
    case "Union":
      return isAbsentOr(areCounts(node.arms), node.arms);
    default:
      throw new TypeError("Unknown shape in validation plan: " + $jsonStringify(node.shape));
  }
}

// The parser's objects are read by name. These have the fields of their types.
function createNodes(parsed: any[]): Plan {
  const nodes: Plan = [];
  for (let i = 0; i < parsed.length; i++) {
    ensureHasOnly(parsed[i], [
      "shape",
      "primitive",
      "value",
      "element",
      "elements",
      "required",
      "rest",
      "arms",
      "members",
      "undeclared",
      "undeclaredValue",
      "discriminant",
      "remembers",
      "rules",
      "message",
      "default",
      "text",
    ]);
    const node: PlanNode = {
      shape: partOf(parsed[i], "shape"),
      primitive: partOf(parsed[i], "primitive"),
      value: partOf(parsed[i], "value"),
      element: partOf(parsed[i], "element"),
      elements: partOf(parsed[i], "elements"),
      required: partOf(parsed[i], "required"),
      rest: partOf(parsed[i], "rest"),
      arms: partOf(parsed[i], "arms"),
      members: createMembers(partOf(parsed[i], "members")),
      undeclared: partOf(parsed[i], "undeclared"),
      undeclaredValue: partOf(parsed[i], "undeclaredValue"),
      discriminant: createDiscriminant(partOf(parsed[i], "discriminant")),
      remembers: partOf(parsed[i], "remembers"),
      rules: createRules(partOf(parsed[i], "rules")),
      message: partOf(parsed[i], "message"),
      default: partOf(parsed[i], "default"),
      text: partOf(parsed[i], "text"),
      describesArrays: undefined,
      describesOtherObjects: undefined,
      hasDefault: undefined,
    };
    if (!hasItsParts(node) || isObject(node.default))
      throw new TypeError("Invalid shape in validation plan: " + node.shape);
    nodes.push(node);
  }
  return nodes;
}

function namesNodes(rule: PlanRule): boolean {
  return (rule.kind >= 13 && rule.kind <= 19) || rule.kind === 23;
}

// A library file has no variables: the engine keeps the Map, and compiled code hands it to every function here that takes a text.
function preparedUnder(name: string, preparedByText: Map<string, any>): any {
  return $call<any>($Map.prototype.get, preparedByText, name);
}

function prepare(text: string, preparedByText: Map<string, Prepared>): Prepared {
  const known: Prepared | undefined = preparedUnder(text, preparedByText);
  if (known !== undefined) return known;
  const parsed = $jsonParse(text);
  const rule = $isArray(parsed) ? undefined : createRule(parsed);
  if (rule !== undefined && namesNodes(rule))
    throw new TypeError("Expected rule to come with its validation plan: " + rule.rule);
  const prepared: Prepared = {
    nodes: rule === undefined ? createNodes(parsed) : [{ shape: "Unknown", rules: [rule] }],
    rule,
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

// A value may hold one object at many places, and each place is visited.
function maxVisitCount(): number {
  return 16777216;
}

function createTests(preparedByText: Map<string, any>): Tests {
  return {
    matchesPattern: preparedUnder("matchesPattern", preparedByText),
    remainingSteps: 100000000,
    mustRefuse: false,
  };
}

function createRun(plan: string, preparedByText: Map<string, any>, isCopy: boolean): Run {
  const prepared = prepare(plan, preparedByText);
  return {
    nodes: prepared.nodes,
    tests: createTests(preparedByText),
    refused: {},
    isBuilding: true,
    verdicts: undefined,
    remainingIssues: maxIssueCount(),
    remainingReportsByRules: 1000,
    reported: undefined,
    optionalUnions: prepared.optionalUnions,
    copies: isCopy ? undefined : new $Map(),
    keptArrays: [],
    isLookedAtAgain: false,
    symbolKeys: undefined,
    saysOnlyJSON: new $Map(),
    remainingHoles: maxHoleCount(),
    remainingVisits: maxVisitCount(),
    acceptances: new $Map(),
    withoutIssues: new $Map(),
    numberOfWriting: new $Map(),
    writingCount: 0,
    numberOfObject: new $Map(),
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
    case "Union":
      return describeArms(run, node.arms ?? []);
  }
}

function describeArms(run: Run, arms: number[]): string {
  let text = "";
  for (let i = 0; i < arms.length; i++) text += (i === 0 ? "" : " | ") + describeArm(run, arms[i]);
  return text;
}

function isObject(value: any): boolean {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isPlainObject(value: any): boolean {
  return isObject(value) && !$isArray(value);
}

// "No match" under Not, PatternMembers or MemberNames accepts the value, so a search that gave up is no answer.
function matches(tests: Tests, source: string, text: string, isUnicode: boolean): boolean {
  const answer = tests.matchesPattern(source, text, isUnicode, tests.remainingSteps);
  const remainingSteps = $numberIsInteger(answer) ? (answer! < 0 ? -1 - answer! : answer!) : -1;
  if (remainingSteps < 0 || remainingSteps > tests.remainingSteps)
    throw new RangeError("Too many steps in regular expression /" + source + "/");
  tests.remainingSteps = remainingSteps;
  return answer! >= 0;
}

function matchesPlaceholder(tests: Tests, kind: string, part: string): boolean {
  switch (kind) {
    case "s":
      return true;
    case "n":
      return part !== "" && $numberIsFinite(+part);
    case "b":
      return matches(tests, "^-?(?:0|[1-9][0-9]*|0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)$", part, false);
    default:
      throw new TypeError("Unknown placeholder in validation plan: " + $jsonStringify(kind));
  }
}

function matchesTemplate(tests: Tests, texts: string[], placeholders: string, value: string): boolean {
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
    if (!matchesPlaceholder(tests, placeholders[i - 1], value.slice(position, partEnd))) return false;
    position = next;
  }
  return matchesPlaceholder(tests, placeholders[last - 1], value.slice(position, end));
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

function isDigit(unit: number): boolean {
  return unit >= 48 && unit <= 57;
}

function isLetter(unit: number): boolean {
  return (unit | 32) >= 97 && (unit | 32) <= 122;
}

function isLetterOrDigit(unit: number): boolean {
  return isDigit(unit) || isLetter(unit);
}

function isHexDigit(unit: number): boolean {
  return isDigit(unit) || ((unit | 32) >= 97 && (unit | 32) <= 102);
}

function readTwoDigits(text: string, at: number): number {
  const tens = text.charCodeAt(at);
  const ones = text.charCodeAt(at + 1);
  return isDigit(tens) && isDigit(ones) ? (tens - 48) * 10 + (ones - 48) : -1;
}

function isDate(text: string): boolean {
  if (text.length !== 10 || text[4] !== "-" || text[7] !== "-") return false;
  const century = readTwoDigits(text, 0);
  const yearOfCentury = readTwoDigits(text, 2);
  const month = readTwoDigits(text, 5);
  const day = readTwoDigits(text, 8);
  if (century < 0 || yearOfCentury < 0 || month < 1 || month > 12 || day < 1) return false;
  const year = century * 100 + yearOfCentury;
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (month === 2) return day <= (isLeapYear ? 29 : 28);
  return day <= (month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31);
}

function isTime(text: string): boolean {
  const size = text.length;
  if (size < 9 || text[2] !== ":" || text[5] !== ":") return false;
  const hour = readTwoDigits(text, 0);
  const minute = readTwoDigits(text, 3);
  const second = readTwoDigits(text, 6);
  if (hour < 0 || minute < 0 || second < 0 || hour > 23 || minute > 59 || second > 60) return false;
  let at = 8;
  if (text[at] === ".") {
    const start = ++at;
    while (at < size && isDigit(text.charCodeAt(at))) at++;
    if (at === start) return false;
  }
  if (at >= size) return false;
  let offset = 0;
  const sign = text[at];
  if (sign === "Z" || sign === "z") {
    if (at + 1 !== size) return false;
  } else if (sign === "+" || sign === "-") {
    const offsetHour = readTwoDigits(text, at + 1);
    const offsetMinute = readTwoDigits(text, at + 4);
    if (at + 6 !== size || text[at + 3] !== ":" || offsetHour < 0 || offsetMinute < 0) return false;
    if (offsetHour > 23 || offsetMinute > 59) return false;
    offset = (offsetHour * 60 + offsetMinute) * (sign === "+" ? 1 : -1);
  } else return false;
  return second !== 60 || (hour * 60 + minute - offset + 2880) % 1440 === 1439;
}

function isDateTime(text: string): boolean {
  return (
    text.length > 11 && (text[10] === "T" || text[10] === "t") && isDate(text.slice(0, 10)) && isTime(text.slice(11))
  );
}

function isDuration(text: string): boolean {
  const size = text.length;
  if (size < 2 || text[0] !== "P") return false;
  let at = 1;
  let inTime = false;
  let sawWeek = false;
  let elements = 0;
  let elementsInTime = 0;
  let rank = -1;
  while (at < size) {
    if (text[at] === "T") {
      if (inTime) return false;
      inTime = true;
      rank = -1;
      at++;
      continue;
    }
    const start = at;
    while (at < size && isDigit(text.charCodeAt(at))) at++;
    if (at === start || at === size) return false;
    let unit = -1;
    if (inTime) {
      unit = "HMS".indexOf(text[at]);
      elementsInTime++;
    } else if (text[at] === "W") {
      sawWeek = true;
      unit = 3;
    } else unit = "YMD".indexOf(text[at]);
    if (unit < 0 || (rank >= 0 && unit !== rank + 1)) return false;
    rank = unit;
    elements++;
    at++;
  }
  if (elements === 0 || (inTime && elementsInTime === 0)) return false;
  return !sawWeek || elements === 1;
}

function isIPv4(text: string): boolean {
  const size = text.length;
  let parts = 0;
  let at = 0;
  while (true) {
    const start = at;
    let value = 0;
    while (at < size && isDigit(text.charCodeAt(at)) && at - start < 4)
      value = value * 10 + (text.charCodeAt(at++) - 48);
    const length = at - start;
    if (length === 0 || length > 3 || value > 255 || (length > 1 && text[start] === "0")) return false;
    if (++parts === 4) return at === size;
    if (at >= size || text[at++] !== ".") return false;
  }
}

function isIPv6(text: string): boolean {
  const size = text.length;
  let groups = 0;
  let sawCompression = false;
  let at = 0;
  if (size < 2) return false;
  if (text[0] === ":") {
    if (text[1] !== ":") return false;
    sawCompression = true;
    at = 2;
    if (at === size) return true;
  }
  while (at < size) {
    const start = at;
    while (at < size && isHexDigit(text.charCodeAt(at))) at++;
    const length = at - start;
    if (at < size && text[at] === ".") {
      if (!isIPv4(text.slice(start))) return false;
      groups += 2;
      at = size;
      break;
    }
    if (length === 0 || length > 4) return false;
    groups++;
    if (at === size) break;
    if (text[at] !== ":") return false;
    at++;
    if (at === size) return false;
    if (text[at] === ":") {
      if (sawCompression) return false;
      sawCompression = true;
      at++;
      if (at === size) break;
    }
  }
  return sawCompression ? groups < 8 : groups === 8;
}

// A label that begins with xn-- stands for characters outside ASCII, and whether those make a name is not judged here.
function isHostname(tests: Tests, text: string): boolean {
  const size = text.length;
  if (size === 0 || size > 253) return false;
  let start = 0;
  let isJudged = true;
  for (let at = 0; at <= size; at++) {
    if (at < size && text[at] !== ".") {
      if (!isLetterOrDigit(text.charCodeAt(at)) && text[at] !== "-") return false;
      continue;
    }
    const length = at - start;
    if (length === 0 || length > 63 || text[start] === "-" || text[at - 1] === "-") return false;
    if (length >= 4 && text[start + 2] === "-" && text[start + 3] === "-") {
      if ((text.charCodeAt(start) | 32) !== 120 || (text.charCodeAt(start + 1) | 32) !== 110) return false;
      isJudged = false;
    }
    start = at + 1;
  }
  if (!isJudged) tests.mustRefuse = true;
  return isJudged;
}

// The place behind the last one, or 0.
function endOfLast(text: string, character: string): number {
  let at = text.length;
  while (at !== 0 && text[at - 1] !== character) at--;
  return at;
}

function isEmail(tests: Tests, text: string): boolean {
  const at = endOfLast(text, "@");
  if (at < 2 || at === text.length) return false;
  const local = text.slice(0, at - 1);
  const domain = text.slice(at);
  if (local.length > 64 && local[0] !== '"') return false;
  if (local[0] === '"') {
    if (local.length < 2 || local[local.length - 1] !== '"') return false;
    for (let i = 1; i + 1 < local.length; i++) {
      if (local[i] === "\\") {
        if (++i + 1 >= local.length) return false;
      } else if (local[i] === '"') return false;
    }
  } else {
    let previousWasDot = true;
    for (let i = 0; i < local.length; i++) {
      if (local[i] === ".") {
        if (previousWasDot) return false;
        previousWasDot = true;
        continue;
      }
      previousWasDot = false;
      if (!isLetterOrDigit(local.charCodeAt(i)) && "!#$%&'*+-/=?^_`{|}~".indexOf(local[i]) < 0) return false;
    }
    if (previousWasDot) return false;
  }
  if (domain[0] === "[") {
    if (domain[domain.length - 1] !== "]") return false;
    const literal = domain.slice(1, domain.length - 1);
    if (literal.length > 5 && literal.startsWith("IPv6:")) return isIPv6(literal.slice(5));
    return isIPv4(literal);
  }
  return isHostname(tests, domain);
}

function areURICharacters(text: string, alsoAllowed: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "%") {
      if (i + 2 >= text.length || !isHexDigit(text.charCodeAt(i + 1)) || !isHexDigit(text.charCodeAt(i + 2)))
        return false;
      i += 2;
      continue;
    }
    if (isLetterOrDigit(text.charCodeAt(i))) continue;
    if ("-._~!$&'()*+,;=".indexOf(text[i]) < 0 && alsoAllowed.indexOf(text[i]) < 0) return false;
  }
  return true;
}

function findAny(text: string, characters: string): number {
  for (let i = 0; i < text.length; i++) {
    if (characters.indexOf(text[i]) >= 0) return i;
  }
  return text.length;
}

function isFutureAddress(text: string): boolean {
  let at = 1;
  while (at < text.length && isHexDigit(text.charCodeAt(at))) at++;
  if ((text[0] !== "v" && text[0] !== "V") || at === 1 || text[at] !== "." || at + 1 === text.length) return false;
  const rest = text.slice(at + 1);
  return findAny(rest, "%") === rest.length && areURICharacters(rest, ":");
}

function isAuthority(text: string): boolean {
  const at = endOfLast(text, "@");
  if (at !== 0) {
    if (!areURICharacters(text.slice(0, at - 1), ":")) return false;
    text = text.slice(at);
  }
  if (text[0] === "[") {
    const close = findAny(text, "]");
    if (close === text.length) return false;
    const literal = text.slice(1, close);
    if (!isIPv6(literal) && !isFutureAddress(literal)) return false;
    text = text.slice(close + 1);
    if (text === "") return true;
    if (text[0] !== ":") return false;
  } else {
    const colon = findAny(text, ":");
    if (!areURICharacters(text.slice(0, colon), "")) return false;
    text = text.slice(colon);
    if (text === "") return true;
  }
  for (let i = 1; i < text.length; i++) {
    if (!isDigit(text.charCodeAt(i))) return false;
  }
  return true;
}

function isHierarchicalPart(text: string, firstSegmentMayHoldColon: boolean): boolean {
  const fragment = findAny(text, "#");
  if (fragment !== text.length) {
    if (!areURICharacters(text.slice(fragment + 1), ":@/?")) return false;
    text = text.slice(0, fragment);
  }
  const query = findAny(text, "?");
  if (query !== text.length) {
    if (!areURICharacters(text.slice(query + 1), ":@/?")) return false;
    text = text.slice(0, query);
  }
  if (text.length >= 2 && text[0] === "/" && text[1] === "/") {
    text = text.slice(2);
    const end = findAny(text, "/");
    if (!isAuthority(text.slice(0, end))) return false;
    text = text.slice(end);
  } else if (!firstSegmentMayHoldColon) {
    const end = findAny(text, "/");
    if (findAny(text.slice(0, end), ":") !== end) return false;
  }
  return areURICharacters(text, ":@/");
}

function schemeLength(text: string): number {
  if (text === "" || !isLetter(text.charCodeAt(0))) return 0;
  for (let i = 1; i < text.length; i++) {
    if (text[i] === ":") return i;
    if (!isLetterOrDigit(text.charCodeAt(i)) && text[i] !== "+" && text[i] !== "-" && text[i] !== ".") return 0;
  }
  return 0;
}

function isURI(text: string): boolean {
  const scheme = schemeLength(text);
  return scheme !== 0 && isHierarchicalPart(text.slice(scheme + 1), true);
}

function isURIReference(text: string): boolean {
  const scheme = schemeLength(text);
  return scheme !== 0 ? isHierarchicalPart(text.slice(scheme + 1), true) : isHierarchicalPart(text, false);
}

function isUUID(text: string): boolean {
  if (text.length !== 36) return false;
  for (let i = 0; i < 36; i++) {
    const isDash = i === 8 || i === 13 || i === 18 || i === 23;
    if (isDash ? text[i] !== "-" : !isHexDigit(text.charCodeAt(i))) return false;
  }
  return true;
}

function isJSONPointer(text: string, from: number): boolean {
  if (from === text.length) return true;
  if (text[from] !== "/") return false;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "~" && text[i + 1] !== "0" && text[i + 1] !== "1") return false;
  }
  return true;
}

function isRelativeJSONPointer(text: string): boolean {
  let at = 0;
  while (at < text.length && isDigit(text.charCodeAt(at))) at++;
  if (at === 0 || (at > 1 && text[0] === "0")) return false;
  if (at + 1 === text.length && text[at] === "#") return true;
  return isJSONPointer(text, at);
}

// The engine makes the expression before it searches, and throws a SyntaxError where there is none to make.
function isRegularExpression(tests: Tests, text: string): boolean {
  try {
    matches(tests, text, "", true);
    return true;
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

function isPrintableASCII(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit > 0x7e || unit < 0x20) return false;
  }
  return true;
}

function matchesFormat(tests: Tests, format: string, text: string): boolean {
  switch (format) {
    case "url":
      return $urlCanParse(text);
    case "regex":
      return isRegularExpression(tests, text);
    case "json-pointer":
      return isJSONPointer(text, 0);
    case "relative-json-pointer":
      return isRelativeJSONPointer(text);
    case "date-time":
      return isPrintableASCII(text) && isDateTime(text);
    case "date":
      return isPrintableASCII(text) && isDate(text);
    case "time":
      return isPrintableASCII(text) && isTime(text);
    case "duration":
      return isPrintableASCII(text) && isDuration(text);
    case "email":
      return isPrintableASCII(text) && isEmail(tests, text);
    case "hostname":
      return isPrintableASCII(text) && isHostname(tests, text);
    case "ipv4":
      return isPrintableASCII(text) && isIPv4(text);
    case "ipv6":
      return isPrintableASCII(text) && isIPv6(text);
    case "uri":
      return isPrintableASCII(text) && isURI(text);
    case "uri-reference":
      return isPrintableASCII(text) && isURIReference(text);
    case "uuid":
      return isPrintableASCII(text) && isUUID(text);
    default:
      throw new TypeError("Unknown format in validation plan: " + format);
  }
}

// A finite number above 0 as it is written: its digits without a zero at either end, and the power of ten that the last of them counts.
function writeAsDecimal(number: number): [string, number] {
  const text = "" + number;
  const exponentAt = text.indexOf("e");
  const mantissa = exponentAt < 0 ? text : text.slice(0, exponentAt);
  const point = mantissa.indexOf(".");
  const digits = point < 0 ? mantissa : mantissa.slice(0, point) + mantissa.slice(point + 1);
  let exponent = (exponentAt < 0 ? 0 : +text.slice(exponentAt + 1)) - (point < 0 ? 0 : mantissa.length - point - 1);
  let start = 0;
  while (digits.charCodeAt(start) === 48) start++;
  let end = digits.length;
  for (; digits.charCodeAt(end - 1) === 48; end--) exponent++;
  return [digits.slice(start, end), exponent];
}

// The number is below the modulus, and that is below 2^52: no sum is rounded.
function timesTenModulo(number: number, modulus: number): number {
  const twice = (number + number) % modulus;
  const fourTimes = (twice + twice) % modulus;
  const fiveTimes = (fourTimes + number) % modulus;
  return (fiveTimes + fiveTimes) % modulus;
}

// 0.07 is seven times 0.01, and the remainder of the two doubles is not 0. So both are taken as the decimals that they are written as, and the division of those is exact.
function isMultipleOfFraction(value: number, divisorDigits: number, divisorExponent: number): boolean {
  if (value === 0) return true;
  const [digits, exponent] = writeAsDecimal(value < 0 ? -value : value);
  // The last digit is not 0, so a value that has more places than the divisor is no multiple.
  if (exponent < divisorExponent) return false;
  let remainder = 0;
  for (let i = 0; i < digits.length; i++)
    remainder = (timesTenModulo(remainder, divisorDigits) + (digits.charCodeAt(i) - 48)) % divisorDigits;
  for (let i = divisorExponent; i < exponent && remainder !== 0; i++)
    remainder = timesTenModulo(remainder, divisorDigits);
  return remainder === 0;
}

// Each rule is about one kind of value and holds for no other. Nothing is made into a number or a text: of an object that would run code of the value.
function canBeTested(rule: PlanRule, value: any): boolean {
  switch (rule.kind) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return $numberIsFinite(value);
    case 6:
    case 7:
      return typeof value === "string" || $isArray(value);
    case 8:
    case 9:
    case 10:
      return typeof value === "string";
    case 11:
      return true;
    default:
      throw new TypeError("Expected rule to come with its validation plan: " + rule.rule);
  }
}

function holds(tests: Tests, rule: PlanRule, value: any): boolean {
  if (!canBeTested(rule, value)) return false;
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
      return rule.divisorDigits === undefined
        ? value % rule.divisor! === 0
        : isMultipleOfFraction(value, rule.divisorDigits, rule.divisorExponent!);
    case 6:
      return hasAtLeast(value, rule.length!);
    case 7:
      return hasAtMost(value, rule.length!);
    case 8:
      return matches(tests, rule.source!, value, rule.isUnicode === true);
    case 9:
      return matchesFormat(tests, rule.format!, value);
    case 10:
      return matchesTemplate(tests, rule.texts!, rule.placeholders!, value);
    case 11:
      return true;
    default:
      throw new TypeError("Unknown rule in validation plan: " + rule.rule);
  }
}

function isPresent(object: any, key: string): boolean {
  return $hasOwn(object, key) && object[key] !== undefined;
}

function writePrimitive(value: any): string {
  if (value === null) return "n";
  if (typeof value === "undefined") return "u";
  if (typeof value === "boolean") return value ? "t" : "f";
  if (typeof value === "number") return "d" + (value + 0);
  if (typeof value === "string") return "s" + value;
  if (typeof value === "bigint") return "b" + value;
  if (typeof value === "symbol") return "y";
  throw new TypeError("Unknown kind of value: " + typeof value);
}

function writeItems(run: Run, items: any[]): string {
  let text = "a";
  for (let i = 0; i < items.length; i++) text += numberOfValue(run, items, i) + ",";
  return text;
}

function writeMembers(run: Run, object: any): string {
  const keys = $objectKeys(object).sort();
  let text = "o";
  for (let i = 0; i < keys.length; i++) {
    if (object[keys[i]] === undefined) continue;
    text += keys[i].length + ":" + keys[i] + numberOfValue(run, object, keys[i]) + ",";
  }
  return text;
}

function numberOfWriting(run: Run, text: string): number {
  const known = run.numberOfWriting.get(text);
  if (known !== undefined) return known;
  const number = run.writingCount++;
  run.numberOfWriting.set(text, number);
  return number;
}

// Two values are equal exactly if they have one number. What is numbered is a copy that nobody else has, and it takes the place of the original.
function numberOfValue(run: Run, holder: any, key: any): number {
  // Nothing says when two functions or two symbols are equal. A function is not read and stays where it is.
  if (typeof holder[key] === "function" || typeof holder[key] === "symbol") {
    run.tests.mustRefuse = true;
    return numberOfWriting(run, "y");
  }
  const value = heldWhollyAt(run, holder, key);
  if (!isObject(value)) return numberOfWriting(run, writePrimitive(value));
  const known = run.numberOfObject.get(value);
  if (known !== undefined) return known;
  const number = numberOfWriting(run, $isArray(value) ? writeItems(run, value) : writeMembers(run, value));
  run.numberOfObject.set(value, number);
  return number;
}

function hasUniqueItems(run: Run, items: any[]): boolean {
  readToEnd(run, items);
  const seen = new $Set<number>();
  for (let i = 0; i < items.length; i++) {
    const number = numberOfValue(run, items, i);
    if (seen.has(number)) return false;
    seen.add(number);
  }
  return true;
}

// Counting ends one above the limit.
function countAcceptedItems(run: Run, at: number, items: any[], limit: number | undefined): number {
  readToEnd(run, items);
  let count = 0;
  for (let i = 0; i < items.length && (limit === undefined || count <= limit); i++) {
    if (accepts(run, at, heldAt(run, items, i, at))) count++;
  }
  return count;
}

function countAcceptingNodes(run: Run, nodes: number[], value: any, limit: number): number {
  let count = 0;
  for (let i = 0; i < nodes.length && count <= limit; i++) {
    if (accepts(run, nodes[i], value)) count++;
  }
  return count;
}

function allAccept(run: Run, nodes: number[], value: any): boolean {
  for (let i = 0; i < nodes.length; i++) {
    if (!accepts(run, nodes[i], value)) return false;
  }
  return true;
}

function isNamedByPattern(run: Run, node: PlanNode, key: string): boolean {
  const rules = node.rules ?? [];
  for (let i = 0; i < rules.length; i++) {
    const sources = rules[i].kind === 18 ? rules[i].sources! : [];
    for (let j = 0; j < sources.length; j++) {
      if (matches(run.tests, sources[j], key, true)) return true;
    }
  }
  return false;
}

function patternMembersHold(run: Run, rule: PlanRule, object: any): boolean {
  const sources = rule.sources!;
  const nodes = rule.nodes!;
  const keys = $objectKeys(object);
  for (let i = 0; i < keys.length; i++) {
    for (let j = 0; j < sources.length; j++) {
      if (!matches(run.tests, sources[j], keys[i], true)) continue;
      if (!accepts(run, nodes[j], heldAt(run, object, keys[i], nodes[j]))) return false;
    }
  }
  return true;
}

function memberNamesHold(run: Run, at: number, object: any): boolean {
  const keys = $objectKeys(object);
  for (let i = 0; i < keys.length; i++) {
    if (!accepts(run, at, keys[i])) return false;
  }
  return true;
}

function areAllPresent(object: any, names: string[]): boolean {
  for (let i = 0; i < names.length; i++) {
    if (!isPresent(object, names[i])) return false;
  }
  return true;
}

// What no JSON text says: a number that is not finite, undefined or a hole among the elements of an array, a bigint, a symbol, a function. A member that holds undefined is absent.
function saysOnlyJSON(run: Run, value: any): boolean {
  if (!isObject(value)) return !isOutsideJSON(value);
  if (typeof value === "function") return false;
  const known = run.saysOnlyJSON.get(value);
  if (known !== undefined) return known;
  let answer = true;
  if ($isArray(value)) {
    readToEnd(run, value);
    for (let i = 0; answer && i < value.length; i++) answer = saysOnlyJSON(run, heldWhollyAt(run, value, i));
  } else {
    const keys = $objectKeys(value);
    for (let i = 0; answer && i < keys.length; i++) {
      const member = heldWhollyAt(run, value, keys[i]);
      answer = member === undefined || saysOnlyJSON(run, member);
    }
  }
  run.saysOnlyJSON.set(value, answer);
  return answer;
}

// A rule under which a node that refuses lets the value pass. Such a node refuses 1e999 where it asks for a number, which says nothing about the number in the text.
function turnsRefusalsRound(rule: PlanRule): boolean {
  return (
    rule.kind === 14 ||
    rule.kind === 15 ||
    rule.kind === 16 ||
    rule.kind === 23 ||
    (rule.kind === 13 && rule.maximum !== undefined)
  );
}

// The value is a copy that heldAt made, or the parser's own.
function holdsInside(run: Run, rule: PlanRule, value: any): boolean {
  // A function is not copied, so nothing is read from it.
  if (typeof value === "function") {
    run.tests.mustRefuse = true;
    return false;
  }
  keep(run, value);
  if (turnsRefusalsRound(rule) && !saysOnlyJSON(run, value)) return false;
  switch (rule.kind) {
    case 12:
      return !$isArray(value) || hasUniqueItems(run, value);
    case 13: {
      if (!$isArray(value)) return true;
      const count = countAcceptedItems(run, rule.node!, value, rule.maximum);
      return count >= rule.minimum! && (rule.maximum === undefined || count <= rule.maximum);
    }
    case 14:
      return !accepts(run, rule.node!, value);
    case 15:
      return accepts(run, accepts(run, rule.condition!, value) ? rule.then! : rule.otherwise!, value);
    case 16:
      return countAcceptingNodes(run, rule.nodes!, value, 1) === 1;
    case 17:
      return allAccept(run, rule.nodes!, value);
    case 18:
      return !isPlainObject(value) || patternMembersHold(run, rule, value);
    case 19:
      return !isPlainObject(value) || memberNamesHold(run, rule.node!, value);
    case 20:
      return !isPlainObject(value) || $objectKeys(value).length >= rule.count!;
    case 21:
      return !isPlainObject(value) || $objectKeys(value).length <= rule.count!;
    case 22:
      return !isPlainObject(value) || !isPresent(value, rule.key!) || areAllPresent(value, rule.names!);
    case 23:
      return !isPlainObject(value) || !isPresent(value, rule.key!) || accepts(run, rule.node!, value);
    default:
      throw new TypeError("Unknown rule in validation plan: " + rule.rule);
  }
}

// A copy that is not read to the end is shorter than its array.
function holdsIn(run: Run, rule: PlanRule, value: any): boolean {
  if (looksInside(rule)) return holdsInside(run, rule, value);
  const unread = isObject(value) ? unreadOf(run, value) : undefined;
  if (unread === undefined) return holds(run.tests, rule, value);
  return canBeTested(rule, value) && holdsOfLength(rule, unread.length);
}

function allHold(run: Run, node: PlanNode, value: any): boolean {
  const rules = node.rules;
  if (rules === undefined) return true;
  for (let i = 0; i < rules.length; i++) {
    if (!holdsIn(run, rules[i], value)) return false;
  }
  return true;
}

function allOfOneSortHold(run: Run, node: PlanNode, value: any, inside: boolean): boolean {
  const rules = node.rules;
  if (rules === undefined) return true;
  for (let i = 0; i < rules.length; i++) {
    if (looksInside(rules[i]) === inside && !holdsIn(run, rules[i], value)) return false;
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

function nodeAt(run: Run, at: number): PlanNode {
  const node = run.nodes[at];
  if (node === undefined) throw new TypeError("Unknown node in validation plan: " + at);
  return node;
}

// What no JSON text holds: undefined, a number that is not finite, a bigint, a symbol, a function.
function isOutsideJSON(value: any): boolean {
  if (typeof value === "number") return !$numberIsFinite(value);
  return typeof value !== "string" && typeof value !== "boolean" && typeof value !== "object";
}

// A type of the program may name undefined or bigint, `object` takes a function, and a default stands in for undefined.
function isNamedBy(run: Run, at: number, value: any): boolean {
  if (value !== undefined && typeof value !== "bigint" && typeof value !== "function") return false;
  const alternatives = [at];
  for (let i = 0; i < alternatives.length; i++) {
    const node = nodeAt(run, alternatives[i]);
    if (typeof value === "function" && node.shape === "AnyObject") return true;
    if (typeof value === "bigint" && node.shape === "Primitive" && node.primitive === "bigint") return true;
    if (value === undefined && (node.shape === "Undefined" || node.default !== undefined)) return true;
    const arms = node.shape === "Union" ? (node.arms ?? []) : [];
    for (let j = 0; j < arms.length; j++) addOnce(alternatives, arms[j]);
  }
  return false;
}

function describes(run: Run, at: number, isArray: boolean): boolean {
  const described = nodeAt(run, at);
  if (described.describesArrays === undefined) {
    let describesArrays = false;
    let describesOtherObjects = false;
    const alternatives = [at];
    for (let i = 0; i < alternatives.length; i++) {
      const node = nodeAt(run, alternatives[i]);
      const arms = node.shape === "Union" ? (node.arms ?? []) : [];
      for (let j = 0; j < arms.length; j++) addOnce(alternatives, arms[j]);
      if (node.shape === "Array" || node.shape === "Tuple") describesArrays = true;
      else if (node.shape === "Dictionary" || node.shape === "Object") describesOtherObjects = true;
      const rules = node.rules ?? [];
      for (let j = 0; j < rules.length; j++) {
        const rule = rules[j];
        if (!looksInside(rule)) continue;
        if (rule.kind === 12 || rule.kind === 13) describesArrays = true;
        else if (rule.kind >= 18) describesOtherObjects = true;
        const sameValue = nodesOfTheSameValue(rule);
        for (let k = 0; k < sameValue.length; k++) addOnce(alternatives, sameValue[k]);
      }
    }
    // The node outlives the call. Where the stack ends above, nothing is stored; the word that is asked for first is stored last.
    described.describesOtherObjects = describesOtherObjects;
    described.describesArrays = describesArrays;
  }
  return (isArray ? described.describesArrays : described.describesOtherObjects) === true;
}

function nodesOfTheSameValue(rule: PlanRule): number[] {
  switch (rule.kind) {
    case 12:
    case 13:
    case 18:
    case 19:
    case 20:
    case 21:
    case 22:
      return [];
    case 14:
    case 23:
      return [rule.node!];
    case 15:
      return [rule.condition!, rule.then!, rule.otherwise!];
    case 16:
    case 17:
      return rule.nodes!;
    default:
      throw new TypeError("Unknown rule in validation plan: " + rule.rule);
  }
}

function countVisit(run: Run): void {
  if (run.remainingVisits === 0)
    throw new RangeError("Too many objects and arrays in value (limit " + maxVisitCount() + ")");
  run.remainingVisits--;
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
  run.copies!.set(copy, { source: value, length: toLength(value.length), isKept: false });
  return copy;
}

// Undefined for an array that is read to the end.
function unreadOf(run: Run, input: any): HeldArray | undefined {
  const held =
    run.copies === undefined || !$isArray(input) ? undefined : (run.copies.get(input) as HeldArray | undefined);
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
  if (!tryReadNext(run, input, unread)) throw new RangeError("Too many holes in arrays (limit " + maxHoleCount() + ")");
}

function heldElement(run: Run, input: any[], unread: HeldArray | undefined, index: number, at: number): any {
  if (unread !== undefined && index >= input.length) readNext(run, input, unread);
  return heldAt(run, input, index, at);
}

// A copy that is handed on as it is holds all that its array holds.
function readToEnd(run: Run, input: any): void {
  const unread = isObject(input) ? unreadOf(run, input) : undefined;
  if (unread === undefined) return;
  while (input.length < unread.length) readNext(run, input, unread);
}

// A rule may have read only the beginning of an array, and the copy is handed on, at any depth.
function readKeptArraysToEnd(run: Run): void {
  const kept = run.keptArrays;
  for (let i = 0; i < kept.length; i++) readToEnd(run, kept[i]);
}

// No type that can be validated declares a key that is a symbol, and JSON has none: the private copy holds what is under the names.
function holdObject(run: Run, value: any): any {
  const all = { ...value };
  const symbols = $getOwnPropertySymbols(all);
  if (symbols.length === 0) return all;
  const copy: any = {};
  const keys = $objectKeys(all);
  for (let i = 0; i < keys.length; i++) define(copy, keys[i], all[keys[i]]);
  (run.symbolKeys ??= new $Map()).set(copy, symbols);
  return copy;
}

function symbolKeysOf(run: Run, input: any): symbol[] | undefined {
  return run.symbolKeys === undefined ? undefined : run.symbolKeys.get(input);
}

// What a rule has looked at is what comes back: the value's own object might answer otherwise the next time.
function keep(run: Run, copy: any): void {
  const held = run.copies === undefined || !isObject(copy) ? undefined : run.copies.get(copy);
  if (held === undefined || held === copy) return;
  if (!$isArray(copy)) {
    run.copies!.set(copy, copy);
    return;
  }
  if ((held as HeldArray).isKept) return;
  (held as HeldArray).isKept = true;
  run.keptArrays.push(copy);
}

// Reading an object may run code of the program: getters, the traps of a proxy. So it is read once, into a private copy that all arms of a union and all rules look at.
// A result holds a private copy only where a rule has looked at it: sourceOf() and putSourcesBack() are the two ways by which a part that is not described goes into a result.
function heldAt(run: Run, holder: any, key: any, at: number): any {
  const value = holder[key];
  const copies = run.copies;
  if (copies === undefined || !isObject(value)) return value;
  if (copies.has(value)) {
    if (!run.isBuilding) keep(run, value);
    return value;
  }
  // No shape but unknown takes a function, so it is not read as an object.
  if (typeof value === "function") return value;
  // What the type says nothing about is asked nothing.
  if (!describes(run, at, true) && !describes(run, at, false)) return value;
  const isArray = $isArray(value);
  if (!describes(run, at, isArray)) return value;
  countVisit(run);
  let copy: any;
  if (isArray) copy = holdArray(run, value);
  else copies.set((copy = holdObject(run, value)), value);
  if (!run.isBuilding) keep(run, copy);
  define(holder, key, copy);
  return copy;
}

// What the type does not describe is handed on as it is: the object of the value, unless a rule has looked at its copy.
function sourceOf(run: Run, input: any): any {
  const held = run.copies === undefined || !isObject(input) ? undefined : run.copies.get(input);
  if (held === undefined) return input;
  if (!$isArray(input)) return held;
  return (held as HeldArray).isKept ? input : (held as HeldArray).source;
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

// For a rule that compares whole values: it reads also what the type says nothing about.
function heldWhollyAt(run: Run, holder: any, key: any): any {
  const value = holder[key];
  const copies = run.copies;
  // A function is not read as an object.
  if (copies === undefined || !isObject(value) || typeof value === "function") return value;
  let copy = value;
  if (!copies.has(value)) {
    countVisit(run);
    if ($isArray(value)) copy = holdArray(run, value);
    else copies.set((copy = holdObject(run, value)), value);
    define(holder, key, copy);
  }
  keep(run, copy);
  readToEnd(run, copy);
  return copy;
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

// The rules of an array or an object come before its result: what they read is copied into the input, and the result is made of that.
function buildArray(run: Run, node: PlanNode, input: any): any {
  if (!$isArray(input)) return run.refused;
  const unread = unreadOf(run, input);
  const length = unread === undefined ? input.length : unread.length;
  if (!allHoldOfLength(node, length) || !allHold(run, node, input)) return run.refused;
  const isBuilding = run.isBuilding;
  const result: any[] = isBuilding ? [] : input;
  for (let i = 0; i < length; i++) {
    const item = build(run, node.element!, heldElement(run, input, unread, i, node.element!));
    if (item === run.refused) return run.refused;
    if (isBuilding) result.push(item);
  }
  return result;
}

function hasLengthOfTuple(node: PlanNode, length: number): boolean {
  const count = node.elements === undefined ? 0 : node.elements.length;
  return length >= (node.required ?? count) && (node.rest !== undefined || length <= count);
}

function buildTuple(run: Run, node: PlanNode, input: any): any {
  const elements = node.elements ?? [];
  if (!$isArray(input)) return run.refused;
  const unread = unreadOf(run, input);
  const length = unread === undefined ? input.length : unread.length;
  if (!hasLengthOfTuple(node, length) || !allHold(run, node, input)) return run.refused;
  const isBuilding = run.isBuilding;
  const result: any[] = isBuilding ? [] : input;
  for (let i = 0; i < length; i++) {
    const element = i < elements.length ? elements[i] : node.rest!;
    const item = build(run, element, heldElement(run, input, unread, i, element));
    if (item === run.refused) return run.refused;
    if (isBuilding) result.push(item);
  }
  return result;
}

function buildDictionary(run: Run, node: PlanNode, input: any): any {
  if (!isPlainObject(input) || !allHold(run, node, input)) return run.refused;
  const isBuilding = run.isBuilding;
  const result: any = isBuilding ? { ...input } : input;
  if (isBuilding && run.isLookedAtAgain) putSourcesBack(run, result);
  const keys = $objectKeys(result);
  for (let i = 0; i < keys.length; i++) {
    const item = build(run, node.element!, heldAt(run, input, keys[i], node.element!));
    if (item === run.refused) return run.refused;
    if (isBuilding && item !== result[keys[i]]) define(result, keys[i], item);
  }
  return result;
}

function buildObject(run: Run, node: PlanNode, input: any): any {
  if (!isPlainObject(input) || !allHold(run, node, input)) return run.refused;
  const isBuilding = run.isBuilding;
  const members = node.members ?? [];
  const result: any = isBuilding ? { ...input } : input;
  if (isBuilding && run.isLookedAtAgain) putSourcesBack(run, result);
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const memberValue = heldMember(run, input, member);
    if (memberValue === undefined && member.isOptional && !appliesDefault(run, member.node)) continue;
    const item = build(run, member.node, memberValue);
    if (item === run.refused) return run.refused;
    if (item === undefined) {
      if (member.mustBeOwn && !$hasOwn(result, member.key)) return run.refused;
    } else if (isBuilding && (item !== memberValue || isObject(item))) define(result, member.key, item);
  }
  if (node.undeclared === "Allowed") return result;
  if (node.undeclared === "Rejected" && symbolKeysOf(run, input) !== undefined) return run.refused;
  const keys = $objectKeys(result);
  for (let i = 0; i < keys.length; i++) {
    if (isDeclared(members, keys[i]) || isNamedByPattern(run, node, keys[i])) continue;
    if (node.undeclared === "Rejected") return run.refused;
    const item = build(run, node.undeclaredValue!, heldAt(run, input, keys[i], node.undeclaredValue!));
    if (item === run.refused) return run.refused;
    if (isBuilding && item !== result[keys[i]]) define(result, keys[i], item);
  }
  return result;
}

function buildUnion(run: Run, at: number, input: any): any {
  const node = run.nodes[at];
  const refused = run.refused;
  const remembers = run.isBuilding && node.remembers === true && isObject(input);
  if (remembers && run.verdicts !== undefined) {
    const known = recall(run.verdicts, at, input);
    if (known !== undefined) return known;
  }
  let arms = allOfOneSortHold(run, node, input, true) ? (node.arms ?? []) : [];
  let result: any = refused;
  const discriminant = isPlainObject(input) && arms.length !== 0 ? node.discriminant : undefined;
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
  if (result !== refused && !allOfOneSortHold(run, node, result, false)) result = refused;
  if (remembers && run.verdicts !== undefined) remember(run.verdicts, at, input, result);
  return result;
}

function buildNode(run: Run, at: number, node: PlanNode, input: any): any {
  const refused = run.refused;
  if (input === undefined && node.default !== undefined) input = node.default;
  // An arm of a union that says less may take it. A rule that could turn the refusal round has looked for such values before it asked.
  // `object` takes a function.
  const takesAnything = node.shape === "Unknown" || (node.shape === "AnyObject" && typeof input === "function");
  if (!takesAnything && isOutsideJSON(input) && !isNamedBy(run, at, input)) return refused;
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
      break;
    case "BooleanLiteral":
    case "NumberLiteral":
    case "StringLiteral":
      if (input !== node.value) return refused;
      break;
    case "Array":
      return buildArray(run, node, input);
    case "Tuple":
      return buildTuple(run, node, input);
    case "Dictionary":
      return buildDictionary(run, node, input);
    case "Object":
      return buildObject(run, node, input);
    case "Union":
      return buildUnion(run, at, input);
    default:
      throw new TypeError("Unknown shape in validation plan: " + $jsonStringify(node.shape));
  }
  return allHold(run, node, input) ? sourceOf(run, input) : refused;
}

// Where nothing is built each node answers once for each copy. So nodes that ask one another about the same copies take no more time than there are nodes and copies.
function build(run: Run, at: number, input: any): any {
  const node = nodeAt(run, at);
  if (run.isBuilding || !isObject(input)) return buildNode(run, at, node, input);
  let result = recall(run.acceptances, at, input);
  if (result === undefined) {
    result = buildNode(run, at, node, input);
    remember(run.acceptances, at, input, result);
  }
  return result;
}

function accepts(run: Run, at: number, input: any): boolean {
  const wasBuilding = run.isBuilding;
  run.isBuilding = false;
  // The caller held the copy before it asked.
  keep(run, input);
  const isAccepted = build(run, at, input) !== run.refused;
  run.isBuilding = wasBuilding;
  return isAccepted;
}

function isMissing(input: any, member: PlanMember, value: any): boolean {
  return value === undefined && member.mustBeOwn && !$hasOwn(input, member.key);
}

// "a number", "an object". A union, a literal, null and undefined stand as they are.
function withArticle(expected: string): string {
  switch (expected) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return "a " + expected;
    case "object":
    case "array":
      return "an " + expected;
    case "tuple":
      return "an array";
    case "int":
      return "an integer";
    default:
      return expected;
  }
}

function nameReceived(received: string): string {
  return received === "nan" ? "NaN" : received === "infinity" ? "Infinity" : received;
}

function countOf(count: string, many: string): string {
  if (count !== "1") return count + " " + many;
  return count + " " + (many.endsWith("ies") ? many.slice(0, -3) + "y" : many.slice(0, -1));
}

// ">=8 characters" is "at least 8 characters", ">0" is "greater than 0".
function spellBound(bound: string): string {
  const isInclusive = bound[1] === "=";
  const rest = bound.slice(isInclusive ? 2 : 1);
  const space = rest.indexOf(" ");
  let limit = rest;
  if (space >= 0) {
    const words = rest.slice(space + 1);
    const end = words.indexOf(" ");
    limit = countOf(rest.slice(0, space), end < 0 ? words : words.slice(0, end)) + (end < 0 ? "" : words.slice(end));
  }
  if (isInclusive) return (bound[0] === ">" ? "at least " : "at most ") + limit;
  return (bound[0] === ">" ? "greater than " : "less than ") + limit;
}

function spellFormat(format: string): string {
  switch (format) {
    case "email":
      return "a valid email address";
    case "uuid":
      return "a valid UUID";
    case "url":
      return "a valid URL";
    case "ipv4":
      return "a valid IPv4 address";
    case "ipv6":
      return "a valid IPv6 address";
    case "date":
      return "a valid ISO 8601 date";
    case "date-time":
      return "a valid ISO 8601 date-time";
    default:
      return "a valid " + format;
  }
}

// The message is `lead`, the path of the issue, `message`. The path is whole only when all issues are found.
// `named` is a key that the message names behind the path.
function createIssue(
  path: any[],
  code: string,
  expected: string,
  value: any,
  ownWords: string | undefined,
  named?: any,
): any {
  const received = describeReceived(value);
  let lead = "Expected ";
  let message = " to be " + withArticle(expected);
  switch (code) {
    case "missing":
      code = "invalid_type";
      lead = "Missing required property ";
      message = "";
      break;
    case "unexpected":
      code = "invalid_type";
      lead = "Unexpected property ";
      message = "";
      break;
    case "invalid_length":
      code = "invalid_type";
      message = " to have " + countOf(expected, "items") + ", received " + named;
      expected = "tuple";
      named = undefined;
      break;
    case "invalid_type":
      if (expected === "number" && typeof value === "number") message = " to be a finite number";
      message += ", received " + (expected === "int" ? quoteReceived(value, received) : nameReceived(received));
      break;
    case "invalid_literal":
      code = "invalid_type";
      message += ", received " + quoteReceived(value, nameReceived(received));
      break;
    case "invalid_union":
      message = " to match one of " + expected;
      break;
    case "invalid_one_of":
      code = "invalid_union";
      message = " to match " + expected;
      break;
    case "invalid_value":
      message += ", received " + quoteReceived(value, nameReceived(received));
      break;
    case "unrecognized_keys":
      lead = "Unknown property ";
      message = "";
      break;
    case "too_small":
    case "too_big": {
      const words = expected.slice(expected.indexOf(" to ") + " to ".length);
      const space = words.indexOf(" ");
      message = " to " + words.slice(0, space) + " " + spellBound(words.slice(space + 1));
      break;
    }
    case "not_multiple_of":
      message = " to be a " + expected;
      break;
    case "not_unique":
      message = " to have unique items";
      break;
    case "invalid_key":
      lead = "Invalid property name ";
      message = "";
      break;
    case "missing_beside":
      code = "invalid_type";
      lead = "Missing required property ";
      message = " (required with " + named + ")";
      named = undefined;
      break;
    case "forbidden":
      code = "invalid_value";
      message = " not to be " + withArticle(expected.slice("anything but ".length));
      break;
    case "invalid_pattern":
      code = "invalid_format";
      message = " to match " + expected.slice("string to match ".length);
      break;
    case "invalid_template":
      code = "invalid_format";
      message = " to match " + expected;
      break;
    case "invalid_format":
      message = " to be " + spellFormat(expected);
      break;
  }
  return {
    path,
    code,
    expected,
    received,
    message: ownWords ?? message,
    isInOwnWords: ownWords !== undefined,
    lead,
    named,
  };
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
  // An array whose length is refused is not read for the other rules.
  const hasRefusedLength = isArray && !allHoldOfLength(node, unread === undefined ? value.length : unread.length);
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if ((hasRefusedLength && looksInside(rule)) || holdsIn(run, rule, value)) continue;
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
        expected = "string to match /" + rule.source + (rule.isUnicode === true ? "/u" : "/");
        break;
      case "Format":
        expected = rule.format!;
        break;
      case "Template":
        code = "invalid_template";
        expected = node.text!;
        break;
      case "Message":
      case "DefaultNull":
      case "DefaultBoolean":
      case "DefaultNumber":
      case "DefaultString":
        continue;
      case "UniqueItems":
        code = "not_unique";
        expected = "array of unique items";
        break;
      case "Contains": {
        const isShort = countAcceptedItems(run, rule.node!, value, rule.maximum) < rule.minimum!;
        code = isShort ? "too_small" : "too_big";
        expected =
          "array to contain " +
          (isShort ? ">=" + rule.minimum : "<=" + rule.maximum) +
          " items of " +
          expectedOf(run, rule.node!);
        break;
      }
      case "Not":
        code = "forbidden";
        expected = "anything but " + expectedOf(run, rule.node!);
        break;
      case "If":
        reportByRule(run, accepts(run, rule.condition!, value) ? rule.then! : rule.otherwise!, value, path, issues);
        continue;
      case "ExactlyOne":
        code = "invalid_one_of";
        expected = "exactly one of " + describeArms(run, rule.nodes!);
        break;
      case "Every":
        for (let j = 0; j < rule.nodes!.length; j++) reportByRule(run, rule.nodes![j], value, path, issues);
        continue;
      case "PatternMembers":
        reportPatternMembers(run, rule, value, path, issues);
        continue;
      case "MemberNames":
        reportMemberNames(run, node, rule.node!, value, path, issues);
        continue;
      case "MinimumMembers":
        code = "too_small";
        expected = "object to have >=" + rule.count + " properties";
        break;
      case "MaximumMembers":
        code = "too_big";
        expected = "object to have <=" + rule.count + " properties";
        break;
      case "DependentMembers":
        reportDependentMembers(run, node, rule, value, path, issues);
        continue;
      case "DependentNode":
        reportByRule(run, rule.node!, value, path, issues);
        continue;
    }
    add(run, issues, createIssue(path, code, expected, value, node.message));
  }
}

function reportByRule(run: Run, at: number, value: any, path: any[], issues: any[]): void {
  if (run.remainingReportsByRules === 0) return;
  run.remainingReportsByRules--;
  report(run, at, value, path, issues);
}

function reportPatternMembers(run: Run, rule: PlanRule, object: any, path: any[], issues: any[]): void {
  const sources = rule.sources!;
  const keys = $objectKeys(object);
  for (let i = 0; i < keys.length && run.remainingIssues !== 0; i++) {
    for (let j = 0; j < sources.length; j++) {
      if (!matches(run.tests, sources[j], keys[i], true)) continue;
      reportByRule(run, rule.nodes![j], heldAt(run, object, keys[i], rule.nodes![j]), withKey(path, keys[i]), issues);
    }
  }
}

function reportMemberNames(run: Run, node: PlanNode, at: number, object: any, path: any[], issues: any[]): void {
  const keys = $objectKeys(object);
  for (let i = 0; i < keys.length && run.remainingIssues !== 0; i++) {
    if (accepts(run, at, keys[i])) continue;
    add(
      run,
      issues,
      createIssue(path, "invalid_key", "object without key " + $jsonStringify(keys[i]), object, node.message, keys[i]),
    );
  }
}

function reportDependentMembers(
  run: Run,
  node: PlanNode,
  rule: PlanRule,
  object: any,
  path: any[],
  issues: any[],
): void {
  const names = rule.names!;
  const expected = "present beside " + $jsonStringify(rule.key);
  for (let i = 0; i < names.length; i++) {
    if (isPresent(object, names[i])) continue;
    add(
      run,
      issues,
      createIssue(withKey(path, names[i]), "missing_beside", expected, undefined, node.message, rule.key),
    );
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
      add(run, issues, createIssue(memberPath, "missing", expectedOf(run, member.node), undefined, message));
    } else if (!member.isOptional && value === undefined && !$hasOwn(input, member.key)) {
      // Whatever the type of the member says about undefined, the reader wants to hear that the member is not there.
      const before = run.remainingIssues;
      const found: any[] = [];
      report(run, member.node, value, memberPath, found);
      if (found.length === 0) continue;
      run.remainingIssues = before;
      const issue = createIssue(
        memberPath,
        "missing",
        expectedOf(run, member.node),
        undefined,
        run.nodes[member.node].message,
      );
      if (!$isArray(found[0])) issue.code = found[0].code;
      add(run, issues, issue);
    } else if (!member.isOptional) report(run, member.node, value, memberPath, issues);
    else if (
      value !== undefined &&
      (run.nodes[member.node].shape === "Never" || run.nodes[member.node].shape === "Undefined")
    )
      add(run, issues, createIssue(memberPath, "unexpected", "undefined", value, run.nodes[member.node].message));
    else if (value !== undefined) report(run, optionalUnionOf(run, member.node), value, memberPath, issues);
    else if (appliesDefault(run, member.node)) report(run, member.node, value, memberPath, issues);
  }
  const undeclaredValue =
    node.shape === "Dictionary" ? node.element : node.undeclared === "Validated" ? node.undeclaredValue : undefined;
  if ((undeclaredValue === undefined && node.undeclared !== "Rejected") || run.remainingIssues === 0) return;
  const keys = $objectKeys(input);
  for (let i = 0; i < keys.length && run.remainingIssues !== 0; i++) {
    const key = keys[i];
    if (isDeclared(members, key) || (node.shape === "Object" && isNamedByPattern(run, node, key))) continue;
    if (undeclaredValue === undefined)
      add(run, issues, createIssue(path, "unrecognized_keys", $jsonStringify(key), input, node.message, key));
    else report(run, undeclaredValue, heldAt(run, input, key, undeclaredValue), withKey(path, key), issues);
  }
  const symbols = undeclaredValue === undefined ? symbolKeysOf(run, input) : undefined;
  if (symbols === undefined) return;
  for (let i = 0; i < symbols.length && run.remainingIssues !== 0; i++)
    add(run, issues, createIssue(path, "unrecognized_keys", String(symbols[i]), input, node.message, symbols[i]));
}

function report(run: Run, at: number, input: any, path: any[], issues: any[]): void {
  if (!isObject(input)) return reportAll(run, at, input, path, issues);
  if (recall(run.withoutIssues, at, input) === true) return;
  const before = run.remainingIssues;
  reportAll(run, at, input, path, issues);
  if (run.remainingIssues === before) remember(run.withoutIssues, at, input, true);
}

function reportAll(run: Run, at: number, input: any, path: any[], issues: any[]): void {
  if (run.remainingIssues === 0) return;
  if (path.length > 8) return reportUnder(run, path, at, input, issues);
  const node = run.nodes[at];
  if (input === undefined && node.default !== undefined) input = node.default;
  let code = "invalid_type";
  let expected = "object";
  switch (node.shape) {
    case "Unknown":
      return reportRules(run, node, input, path, issues);
    case "Never":
      code = "unexpected";
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
      if (isObject(input) && typeof input !== "function") return reportRules(run, node, input, path, issues);
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
      const length = unread === undefined ? input.length : unread.length;
      if (!hasLengthOfTuple(node, length)) {
        const isFixed = node.rest === undefined && (node.required ?? elements.length) === elements.length;
        if (!isFixed) break;
        return add(
          run,
          issues,
          createIssue(path, "invalid_length", String(elements.length), input, node.message, length),
        );
      }
      reportRules(run, node, input, path, issues);
      for (let i = 0; i < length && run.remainingIssues !== 0; i++) {
        if (unread !== undefined && i >= input.length && !tryReadNext(run, input, unread)) return;
        const element = i < elements.length ? elements[i] : node.rest!;
        report(run, element, heldAt(run, input, i, element), withKey(path, i), issues);
      }
      return;
    }
    case "Dictionary":
    case "Object":
      if (!isPlainObject(input) || typeof input === "function") break;
      reportRules(run, node, input, path, issues);
      return reportMembers(run, node, input, path, issues);
    case "Union":
      return node.remembers === true && isObject(input)
        ? reportOnce(run, at, input, path, issues)
        : reportUnion(run, at, input, path, issues);
  }
  add(run, issues, createIssue(path, code, expected, input, node.message));
}

function holdsOnlyLiterals(run: Run, union: PlanNode): boolean {
  const arms = union.arms ?? [];
  for (let i = 0; i < arms.length; i++) {
    const shape = run.nodes[arms[i]].shape;
    if (shape !== "StringLiteral" && shape !== "NumberLiteral" && shape !== "BooleanLiteral" && shape !== "Null")
      return false;
  }
  return true;
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
    createIssue(
      path,
      nearArmCount > 1 ? "invalid_union" : holdsOnlyLiterals(run, node) ? "invalid_literal" : "invalid_type",
      expectedOf(run, at),
      input,
      node.message,
    ),
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
      const { isInOwnWords, lead, named, ...issue } = entry;
      const whole = [...path, ...entry.path];
      const place = formatPath(named === undefined ? whole : [...whole, named]) || "value";
      issues.push({ ...issue, path: whole, message: isInOwnWords ? entry.message : lead + place + entry.message });
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
    else text += "[" + (typeof key === "symbol" ? String(key) : $jsonStringify(key)) + "]";
  }
  return text;
}

function messageOf(issues: any[], isInOwnWords: boolean): string {
  const first = issues[0];
  const path = formatPath(first.path);
  const rest = issues.length > 1 ? "and " + (issues.length - 1) + " more" : "";
  if (!isInOwnWords) return first.message + (rest && " (" + rest + ")");
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
    // The value is refused already. Reading the message or the issues of that error throws nothing, also where a search gives up on the way.
    let found: any[] = [];
    try {
      found = findIssues(run, copy);
    } catch {}
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
  if (result !== run.refused && !run.tests.mustRefuse) {
    readKeptArraysToEnd(run);
    return result;
  }
  const found = findIssues(run, held);
  if (found.length === 0) addIssueOfRoot(run, found, held);
  throw errorOf(found);
}

export function interpretNode(value: unknown, plan: string, prepared: Map<string, Prepared>): [boolean, unknown] {
  const run = createRun(plan, prepared, false);
  const result = build(run, 0, heldRoot(run, value));
  if (result === run.refused || run.tests.mustRefuse) return [false, undefined];
  readKeptArraysToEnd(run);
  return [true, result];
}

// The text is that of one rule, or that of a plan: then its first node is asked. A rule that names nodes comes in a plan.
export function holdsRule(value: unknown, rule: string, prepared: Map<string, any>): boolean {
  const alone = prepare(rule, prepared).rule;
  if (alone !== undefined && !looksInside(alone)) return holds(createTests(prepared), alone, value);
  const run = createRun(rule, prepared, false);
  return build(run, 0, heldRoot(run, value)) !== run.refused && !run.tests.mustRefuse;
}

export function copyOwnProperties(value: object): object {
  return { ...value };
}
