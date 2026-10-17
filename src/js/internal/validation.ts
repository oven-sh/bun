function describeReceived(value: any): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : Number.isNaN(value) ? "nan" : "infinity";
  if (typeof value === "string") return "string";
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return typeof value;
}

function expectedOf(nodes: any[], at: number): string {
  const node = nodes[at];
  switch (node[0]) {
    case 0:
      return "unknown";
    case 1:
      return "never";
    case 2:
      return node[1];
    case 3:
      return JSON.stringify(node[1]);
    case 5:
      return "array";
    case 6:
      return "tuple";
    case 9: {
      const arms = node[1];
      let text = expectedOf(nodes, arms[0]);
      for (let i = 1; i < arms.length; i++) text += " | " + expectedOf(nodes, arms[i]);
      return text;
    }
    case 10:
      return "undefined";
    default:
      return "object";
  }
}

function isPlainObject(value: any): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesPlaceholder(kind: string, part: string): boolean {
  if (kind === "s") return true;
  if (kind === "n") return part !== "" && Number.isFinite(+part);
  return /^-?(?:0|[1-9][0-9]*|0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)$/.test(part);
}

function matchesTemplate(texts: string[], kinds: string, value: string): boolean {
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
    if (partEnd < 0 || next > end || !matchesPlaceholder(kinds[i - 1], value.slice(position, partEnd))) return false;
    position = next;
  }
  return matchesPlaceholder(kinds[last - 1], value.slice(position, end));
}

function holds(rule: any[], value: any): boolean {
  switch (rule[0]) {
    case "int":
      return Number.isInteger(value);
    case "min":
      return value >= rule[1];
    case "max":
      return value <= rule[1];
    case "above":
      return value > rule[1];
    case "below":
      return value < rule[1];
    case "multipleOf":
      return value % rule[1] === 0;
    case "minLength":
      return value.length >= rule[1];
    case "maxLength":
      return value.length <= rule[1];
    case "pattern":
      return new RegExp(rule[1]).test(value);
    case "template":
      return matchesTemplate(rule[1], rule[3], value);
    default:
      return rule[1] === "" ? (URL as any).canParse(value) : new RegExp(rule[1]).test(value);
  }
}

function allHold(node: any[], value: any): boolean {
  const rules = node[3];
  for (let i = 0; i < rules.length; i++) {
    if (!holds(rules[i], value)) return false;
  }
  return true;
}

function isDeclared(members: any[], key: string): boolean {
  for (let i = 0; i < members.length; i++) {
    if (members[i][0] === key) return true;
  }
  return false;
}

function define(made: any, key: string, value: any): void {
  Object.defineProperty(made, key, { value, writable: true, enumerable: true, configurable: true });
}

function build(nodes: any[], at: number, input: any, refused: object): any {
  const node = nodes[at];
  if (node[5] && input === undefined) input = node[6];
  let made: any = input;
  switch (node[0]) {
    case 0:
      break;
    case 1:
      return refused;
    case 2:
      if (typeof input !== node[1]) return refused;
      if (node[1] === "number" && !Number.isFinite(input)) return refused;
      break;
    case 3:
      if (input !== node[1]) return refused;
      made = node[1];
      break;
    case 4:
      if (typeof input !== "object" || input === null) return refused;
      break;
    case 5: {
      if (!Array.isArray(input)) return refused;
      if (!allHold(node, input)) return refused;
      made = [];
      for (let i = 0, length = input.length; i < length; i++) {
        const item = build(nodes, node[1], input[i], refused);
        if (item === refused) return refused;
        made.push(item);
      }
      return made;
    }
    case 6: {
      const elements = node[1];
      if (!Array.isArray(input) || input.length !== elements.length) return refused;
      made = [];
      for (let i = 0; i < elements.length; i++) {
        const item = build(nodes, elements[i], input[i], refused);
        if (item === refused) return refused;
        made.push(item);
      }
      break;
    }
    case 7: {
      if (!isPlainObject(input)) return refused;
      made = {};
      const keys = Object.keys(input);
      for (let i = 0; i < keys.length; i++) {
        const item = build(nodes, node[1], input[keys[i]], refused);
        if (item === refused) return refused;
        define(made, keys[i], item);
      }
      break;
    }
    case 8: {
      if (!isPlainObject(input)) return refused;
      const members = node[1];
      const checked: any[] = [];
      for (let i = 0; i < members.length; i++) {
        let item = build(nodes, members[i][1], input[members[i][0]], refused);
        if (item === refused) {
          if (members[i][2] !== 2) return refused;
          item = undefined;
        }
        checked.push(item);
      }
      made = {};
      for (let i = 0; i < members.length; i++) {
        if (!members[i][2]) define(made, members[i][0], checked[i]);
      }
      for (let i = 0; i < members.length; i++) {
        if (members[i][2] && checked[i] !== undefined) define(made, members[i][0], checked[i]);
      }
      if (node[2] !== -1) {
        const keys = Object.keys(input);
        for (let i = 0; i < keys.length; i++) {
          if (isDeclared(members, keys[i])) continue;
          if (node[2] === -2) return refused;
          const item = build(nodes, node[2], input[keys[i]], refused);
          if (item === refused) return refused;
          define(made, keys[i], item);
        }
      }
      break;
    }
    case 10:
      if (input !== undefined) return refused;
      break;
    default: {
      const arms = node[1];
      made = refused;
      for (let i = 0; i < arms.length && made === refused; i++) made = build(nodes, arms[i], input, refused);
      if (made === refused) return refused;
    }
  }
  return allHold(node, made) ? made : refused;
}

function add(issues: any[], path: any[], code: string, expected: string, value: any, message: any): void {
  const received = describeReceived(value);
  const written =
    code === "invalid_type" || code === "invalid_value" || code === "invalid_union"
      ? "Invalid input: expected " + expected + ", received " + received
      : code === "unrecognized_keys"
        ? "Unrecognized key: " + expected
        : "Invalid input: expected " + expected;
  issues.push({ path, code, expected, received, message: message === null ? written : message });
}

function reportRules(node: any[], value: any, path: any[], issues: any[]): void {
  const rules = node[3];
  const items = Array.isArray(value);
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (holds(rule, value)) continue;
    let code = "invalid_format";
    let before = "";
    let after = "";
    switch (rule[0]) {
      case "int":
        add(issues, path, "invalid_type", "int", value, node[4]);
        continue;
      case "min":
        code = "too_small";
        before = "number to be >=";
        break;
      case "max":
        code = "too_big";
        before = "number to be <=";
        break;
      case "above":
        code = "too_small";
        before = "number to be >";
        break;
      case "below":
        code = "too_big";
        before = "number to be <";
        break;
      case "multipleOf":
        code = "not_multiple_of";
        before = "multiple of ";
        break;
      case "minLength":
        code = "too_small";
        before = items ? "array to have >=" : "string to have >=";
        after = items ? " items" : " characters";
        break;
      case "maxLength":
        code = "too_big";
        before = items ? "array to have <=" : "string to have <=";
        after = items ? " items" : " characters";
        break;
      case "pattern":
        before = "string to match /";
        after = "/";
        break;
      default:
        add(issues, path, code, rule[2], value, node[4]);
        continue;
    }
    add(issues, path, code, before + rule[1] + after, value, node[4]);
  }
}

function withKey(path: any[], key: any): any[] {
  return [...path, key];
}

function isNearArm(arm: any[], input: any): boolean {
  switch (arm[0]) {
    case 2:
      return typeof input === arm[1] && (arm[1] !== "number" || Number.isFinite(input));
    case 5:
    case 6:
      return Array.isArray(input);
    case 7:
    case 8:
      return isPlainObject(input);
    default:
      return false;
  }
}

function reportMembers(nodes: any[], node: any[], from: number, input: any, path: any[], issues: any[]): void {
  reportMembersWith(undefined, undefined, nodes, node, from, input, path, issues);
}

function reportElements(
  pending: any[],
  validate: any,
  nodes: any[],
  node: any[],
  from: number,
  list: any[],
  key: any,
  issues: any[],
): void {
  for (let i = from; i < list.length; i++) {
    if (validate !== undefined && validate(list[i]) !== undefined) continue;
    const found: any[] = [];
    reportBelow(nodes, node[1], list[i], i, pending[0], found);
    pending[0] = undefined;
    if (key === undefined) for (let j = 0; j < found.length; j++) issues.push(found[j]);
    else reportBelow(nodes, 0, undefined, key, found, issues);
  }
}

function reportMembersWith(
  pending: any,
  compiled: any,
  nodes: any[],
  node: any[],
  from: number,
  input: any,
  path: any[],
  issues: any[],
): void {
  const members = node[0] === 8 ? node[1] : [];
  const others = node[0] === 8 ? node[2] : node[1];
  const kinds: number[] = node[0] === 8 ? node[7] : [];
  for (let i = from; i < members.length; i++) {
    const member = members[i];
    if (member[2] === 2) continue;
    const name = member[0];
    const value = input[name];
    const kind = kinds[i];
    if (
      kind === 1
        ? typeof value === "number" && Number.isFinite(value)
        : kind === 2
          ? typeof value === "string"
          : kind === 3 && typeof value === "boolean"
    )
      continue;
    let validate: any = undefined;
    if (compiled !== undefined) {
      for (let j = 0; j < compiled.length; j += 2) {
        if (compiled[j] === i) validate = compiled[j + 1];
      }
    }
    const child = nodes[member[1]];
    if (validate === undefined || (child[0] === 5 && !Array.isArray(value))) {
      report(nodes, member[1], value, withKey(path, name), issues);
    } else if (child[0] === 5) {
      reportRules(child, value, withKey(path, name), issues);
      reportElements(pending, validate, nodes, child, 0, value, name, issues);
    } else if (validate(value) === undefined) {
      reportBelow(nodes, member[1], value, name, pending[0], issues);
      pending[0] = undefined;
    }
  }
  if (others === -1) return;
  const keys = Object.keys(input);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (isDeclared(members, key)) continue;
    if (others === -2) add(issues, path, "unrecognized_keys", JSON.stringify(key), input, node[4]);
    else report(nodes, others, input[key], withKey(path, key), issues);
  }
}

function report(nodes: any[], at: number, input: any, path: any[], issues: any[]): void {
  const node = nodes[at];
  const kind = node[0];
  const detail = node[1];
  if (node[5] && input === undefined) input = node[6];
  let code = "invalid_type";
  let expected = "object";
  switch (kind) {
    case 0:
      return;
    case 1:
      expected = "never";
      break;
    case 2:
      if (isNearArm(node, input)) return reportRules(node, input, path, issues);
      expected = detail;
      break;
    case 3:
      if (input === detail) return;
      code = "invalid_value";
      expected = JSON.stringify(detail);
      break;
    case 10:
      if (input === undefined) return;
      code = "invalid_value";
      expected = "undefined";
      break;
    case 4:
      if (typeof input === "object" && input !== null) return;
      break;
    case 5:
      expected = "array";
      if (!Array.isArray(input)) break;
      reportRules(node, input, path, issues);
      for (let i = 0; i < input.length; i++) report(nodes, detail, input[i], withKey(path, i), issues);
      return;
    case 6:
      expected = "tuple";
      if (!Array.isArray(input) || input.length !== detail.length) break;
      for (let i = 0; i < detail.length; i++) report(nodes, detail[i], input[i], withKey(path, i), issues);
      return;
    case 7:
    case 8:
      if (!isPlainObject(input)) break;
      return reportMembers(nodes, node, 0, input, path, issues);
    default: {
      let ofNearArm: any[] = [];
      let count = 0;
      for (let i = 0; i < detail.length; i++) {
        const arm = detail[i];
        const found: any[] = [];
        report(nodes, arm, input, path, found);
        if (found.length === 0) return reportRules(node, input, path, issues);
        if (isNearArm(nodes[arm], input)) {
          ofNearArm = found;
          count++;
        }
      }
      if (count === 1) {
        for (let i = 0; i < ofNearArm.length; i++) issues.push(ofNearArm[i]);
        return;
      }
      if (count > 1) code = "invalid_union";
      expected = expectedOf(nodes, at);
    }
  }
  add(issues, path, code, expected, input, node[4]);
}

export function issuesOf(plan: any[], value: any): any[] {
  const issues: any[] = [];
  report(plan[1], plan[0], value, [], issues);
  if (issues.length === 0)
    throw new Error("Internal error: a value was refused by its type and no issue was found. This is a bug in Bun.");
  return issues;
}

function reportBelow(nodes: any[], at: number, input: any, key: any, found: any[] | undefined, issues: any[]): void {
  if (found === undefined) return report(nodes, at, input, [key], issues);
  for (let i = 0; i < found.length; i++) {
    found[i].path = [key, ...found[i].path];
    issues.push(found[i]);
  }
}

export function preparePlan(text: string, pending: any[]): any[] {
  const plan = JSON.parse(text);
  plan.push(pending);
  return plan;
}

export function recordFailure(plan: any[], at: number, position: number, value: any, compiled: any): void {
  const pending = plan[2];
  const found = pending[0];
  pending[0] = undefined;
  const nodes = plan[1];
  const node = nodes[at];
  const issues: any[] = [];
  if (node[0] === 5) {
    reportBelow(nodes, node[1], value[position], position, found, issues);
    reportElements(pending, compiled, nodes, node, position + 1, value, undefined, issues);
  } else if (!isPlainObject(value)) {
    report(nodes, at, value, [], issues);
  } else {
    const members = node[1];
    if (position < members.length) {
      const member = members[position];
      reportBelow(nodes, member[1], value[member[0]], member[0], found, issues);
    }
    reportMembersWith(pending, compiled, nodes, node, position + 1, value, [], issues);
  }
  pending[0] = issues;
}

export function takeIssues(plan: any[], value: any): any[] {
  const pending = plan[2];
  const found = pending[0];
  pending[0] = undefined;
  return found === undefined || found.length === 0 ? issuesOf(plan, value) : found;
}

export function failureWithIssues(plan: any[], value: any): any {
  return { success: false, issues: issuesOf(plan, value) };
}

export function throwIssues(issues: any[]): never {
  const first = issues[0];
  const error: any = new TypeError((first.path.length ? first.path.join(".") + ": " : "") + first.message);
  error.issues = issues;
  throw error;
}

export function validateByPlan(plan: any[], value: any): any {
  const refused = {};
  const made = build(plan[1], plan[0], value, refused);
  return made === refused ? throwIssues(issuesOf(plan, value)) : made;
}

export function safeValidateByPlan(plan: any[], value: any): any {
  const refused = {};
  const made = build(plan[1], plan[0], value, refused);
  return made === refused ? failureWithIssues(plan, value) : { success: true, data: made };
}

export function planSchema(plan: any[]): any {
  return {
    "~standard": {
      version: 1,
      vendor: "bun",
      validate(value: any): any {
        const refused = {};
        const made = build(plan[1], plan[0], value, refused);
        return made === refused ? { issues: issuesOf(plan, value) } : { value: made };
      },
    },
  };
}
