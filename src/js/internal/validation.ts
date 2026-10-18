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

function isObject(value: any): boolean {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isPlainObject(value: any): boolean {
  return isObject(value) && !Array.isArray(value);
}

function matchesPlaceholder(kind: string, part: string): boolean {
  if (kind === "s") return true;
  if (kind === "n") return part !== "" && Number.isFinite(+part);
  return /^-?(?:0|[1-9][0-9]*|0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)$/.test(part);
}

function matchesTemplate(texts: string[], kinds: string, value: string): boolean {
  const last = texts.length - 1;
  if (value.length < texts[0].length + texts[last].length || !value.startsWith(texts[0]) || !value.endsWith(texts[last])) return false;
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

function memberOf(input: any, member: any[]): any {
  return Object.prototype.propertyIsEnumerable.call(input, member[0]) ? input[member[0]] : undefined;
}

function addOnce(list: number[], at: number): void {
  if (!list.includes(at)) list.push(at);
}

function copyOf(nodes: any[], alternatives: number[], input: any): any {
  if (!isObject(input)) return input;
  const isArray = Array.isArray(input);
  const described: any[] = [];
  for (let i = 0; i < alternatives.length; i++) {
    const node = nodes[alternatives[i]];
    if (node[0] === 9) for (let j = 0; j < node[1].length; j++) addOnce(alternatives, node[1][j]);
    else if (isArray ? node[0] === 5 || node[0] === 6 : node[0] === 7 || node[0] === 8) described.push(node);
  }
  if (described.length === 0) return input;
  if (isArray) {
    const made = Array.from(input);
    for (let i = 0; i < made.length; i++) {
      const below: number[] = [];
      for (let j = 0; j < described.length; j++) {
        if (described[j][0] === 5) addOnce(below, described[j][1]);
        else if (i < described[j][1].length) addOnce(below, described[j][1][i]);
      }
      made[i] = copyOf(nodes, below, made[i]);
    }
    return made;
  }
  const made: any = { ...input };
  const keys = new Set<string>();
  for (let j = 0; j < described.length; j++) {
    const members = described[j][0] === 8 ? described[j][1] : [];
    for (let i = 0; i < members.length; i++) {
      if (Object.prototype.propertyIsEnumerable.call(made, members[i][0])) keys.add(members[i][0]);
    }
  }
  const all = Object.keys(made);
  for (let i = 0; i < all.length; i++) keys.add(all[i]);
  for (const key of keys) {
    const held = made[key];
    if (!isObject(held)) continue;
    const below: number[] = [];
    for (let j = 0; j < described.length; j++) {
      const node = described[j];
      let at = node[0] === 7 ? node[1] : node[2];
      for (let k = 0; node[0] === 8 && k < node[1].length; k++) {
        if (node[1][k][0] === key) at = node[1][k][1];
      }
      if (at >= 0) addOnce(below, at);
    }
    const copied = copyOf(nodes, below, held);
    if (copied !== held) define(made, key, copied);
  }
  return made;
}

function holdsDefault(plan: any[]): boolean {
  return (plan[3] ??= plan[1].some((node: any[]) => node[5]));
}

export function startRemembering(memory: any[]): void {
  memory[0] ??= new Map();
}

export function recall(memory: any[], at: number, input: any): any {
  const known = isObject(input) ? memory[0].get(input) : undefined;
  if (known === undefined) return undefined;
  for (let i = 0; i < known.length; i += 2) {
    if (known[i] === at) return known[i + 1];
  }
  return undefined;
}

export function remember(memory: any[], at: number, input: any, verdict: any): void {
  if (!isObject(input)) return;
  const known = memory[0].get(input);
  if (known === undefined) memory[0].set(input, [at, verdict]);
  else known.push(at, verdict);
}

function build(nodes: any[], at: number, input: any, refused: any[], copies: boolean): any {
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
      break;
    case 4:
      if (!isObject(input)) return refused;
      break;
    case 5: {
      if (!Array.isArray(input)) return refused;
      if (copies) made = Array.from(input);
      if (!allHold(node, made)) return refused;
      for (let i = 0, length = made.length; i < length; i++) {
        const item = build(nodes, node[1], made[i], refused, copies);
        if (item === refused) return refused;
        if (copies) made[i] = item;
      }
      return made;
    }
    case 6: {
      const elements = node[1];
      if (!Array.isArray(input) || input.length !== elements.length) return refused;
      if (copies) made = [];
      for (let i = 0; i < elements.length; i++) {
        const item = build(nodes, elements[i], input[i], refused, copies);
        if (item === refused) return refused;
        if (copies) made.push(item);
      }
      break;
    }
    case 7: {
      if (!isPlainObject(input)) return refused;
      if (copies) made = {};
      const keys = Object.keys(input);
      for (let i = 0; i < keys.length; i++) {
        const item = build(nodes, node[1], input[keys[i]], refused, copies);
        if (item === refused) return refused;
        if (copies) define(made, keys[i], item);
      }
      break;
    }
    case 8: {
      if (!isPlainObject(input)) return refused;
      const members = node[1];
      if (copies) made = { ...input };
      for (let i = 0; i < members.length; i++) {
        const given = memberOf(made, members[i]);
        const item = build(nodes, members[i][1], given, refused, copies);
        if (item === refused) return refused;
        if (item === undefined) {
          if (!(members[i][2] & 1) && !Object.hasOwn(made, members[i][0])) return refused;
        } else if (item !== given) define(made, members[i][0], item);
      }
      if (node[2] !== -1) {
        const keys = Object.keys(made);
        for (let i = 0; i < keys.length; i++) {
          if (isDeclared(members, keys[i])) continue;
          if (node[2] === -2) return refused;
          const item = build(nodes, node[2], made[keys[i]], refused, copies);
          if (item === refused) return refused;
          if (item !== made[keys[i]]) define(made, keys[i], item);
        }
      }
      break;
    }
    case 10:
      if (input !== undefined) return refused;
      break;
    default: {
      const remembers = node.length > 7 && isObject(input);
      if (remembers && refused[0] !== undefined) {
        const known = recall(refused, at, input);
        if (known !== undefined) return known;
      }
      let arms = node[1];
      made = refused;
      const tags = isPlainObject(input) ? tagsOf(nodes, node) : [];
      if (tags.length !== 0) {
        const which = tags[1].indexOf(input[tags[0]]);
        if (which >= 0) made = build(nodes, tags[2][which], input, refused, copies);
        if (which >= 0 && made === refused && remembers) startRemembering(refused);
        arms = tags[3];
      }
      for (let i = 0; i < arms.length && made === refused; i++) {
        made = build(nodes, arms[i], input, refused, copies);
        if (made === refused && remembers) startRemembering(refused);
      }
      if (made !== refused && !allHold(node, made)) made = refused;
      if (remembers && refused[0] !== undefined) remember(refused, at, input, made);
      return made;
    }
  }
  return allHold(node, made) ? made : refused;
}

function isMissing(input: any, member: any[], value: any): boolean {
  return value === undefined && (member[2] & 4) !== 0 && !Object.hasOwn(input, member[0]);
}

const MOST_ISSUES = 100;
let room = 0;

function add(issues: any[], path: any[], code: string, expected: string, value: any, message: any): void {
  if (room === 0) return;
  room--;
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

function tagUnder(nodes: any[], arm: any[], name: string): any[] | undefined {
  if (arm[0] !== 8) return undefined;
  const members = arm[1];
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    if (member[0] !== name) continue;
    const held = nodes[member[1]];
    return held[0] === 3 && !(member[2] & 1) && !held[5] && held[3].length === 0 ? held : undefined;
  }
  return undefined;
}

function tagsOf(nodes: any[], union: any[]): any[] {
  if (union[2] !== null) return union[2];
  const arms = union[1];
  let tags: any[] = [];
  for (let i = 0; i < arms.length && tags.length === 0; i++) {
    const members = nodes[arms[i]][0] === 8 ? nodes[arms[i]][1] : [];
    for (let j = 0; j < members.length && tags.length === 0; j++) {
      const name = members[j][0];
      if (tagUnder(nodes, nodes[arms[i]], name) === undefined) continue;
      const values: any[] = [];
      const tagged: number[] = [];
      const untagged: number[] = [];
      let expected = "";
      for (let k = 0; k < arms.length; k++) {
        const tag = tagUnder(nodes, nodes[arms[k]], name);
        if (tag === undefined) {
          untagged.push(arms[k]);
          continue;
        }
        if (values.includes(tag[1])) break;
        expected += (values.length ? " | " : "") + JSON.stringify(tag[1]);
        values.push(tag[1]);
        tagged.push(arms[k]);
      }
      if (values.length > 1 && values.length + untagged.length === arms.length) tags = [name, values, tagged, untagged, expected];
    }
  }
  union[2] = tags;
  return tags;
}

function reportMembers(nodes: any[], node: any[], from: number, input: any, path: any[], issues: any[]): void {
  reportMembersWith(undefined, undefined, nodes, node, from, input, path, issues);
}

function reportElements(pending: any[], validate: any, nodes: any[], node: any[], from: number, list: any[], key: any, issues: any[]): void {
  for (let i = from; i < list.length && room !== 0; i++) {
    if (validate !== undefined && validate(list[i]) !== undefined) continue;
    reportBelow(nodes, node[1], list[i], key === undefined ? [i] : [key, i], pending[0], pending[1], issues);
    pending[0] = undefined;
  }
}

function reportMembersWith(pending: any, compiled: any, nodes: any[], node: any[], from: number, input: any, path: any[], issues: any[]): void {
  const members = node[0] === 8 ? node[1] : [];
  const others = node[0] === 8 ? node[2] : node[1];
  const kinds: number[] = node[0] === 8 ? node[7] : [];
  for (let i = from; i < members.length && room !== 0; i++) {
    const member = members[i];
    const name = member[0];
    const value = memberOf(input, member);
    const kind = kinds[i];
    if (isMissing(input, member, value)) {
      add(issues, withKey(path, name), "invalid_type", expectedOf(nodes, member[1]), undefined, nodes[member[1]][4]);
      continue;
    }
    if (kind === 1 ? typeof value === "number" && Number.isFinite(value) : kind === 2 ? typeof value === "string" : kind === 3 && typeof value === "boolean") continue;
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
      reportBelow(nodes, member[1], value, [name], pending[0], pending[1], issues);
      pending[0] = undefined;
    }
  }
  if (others === -1 || room === 0) return;
  const keys = Object.keys(input);
  for (let i = 0; i < keys.length && room !== 0; i++) {
    const key = keys[i];
    if (isDeclared(members, key)) continue;
    if (others === -2) add(issues, path, "unrecognized_keys", JSON.stringify(key), input, node[4]);
    else report(nodes, others, input[key], withKey(path, key), issues);
  }
}

function report(nodes: any[], at: number, input: any, path: any[], issues: any[]): void {
  if (room === 0) return;
  if (path.length > 8) return reportUnder(path, nodes, at, input, issues);
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
      if (isObject(input)) return;
      break;
    case 5:
      expected = "array";
      if (!Array.isArray(input)) break;
      reportRules(node, input, path, issues);
      for (let i = 0; i < input.length && room !== 0; i++) report(nodes, detail, input[i], withKey(path, i), issues);
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
    default:
      return node.length > 7 && isObject(input) ? reportOnce(nodes, at, input, path, issues) : reportUnion(nodes, at, input, path, issues);
  }
  add(issues, path, code, expected, input, node[4]);
}

function reportUnion(nodes: any[], at: number, input: any, path: any[], issues: any[]): void {
  const node = nodes[at];
  const before = room;
  let ofNearArm: any[] = [];
  let leftByNearArm = before;
  let count = 0;
  let arms = node[1];
  const tags = isPlainObject(input) ? tagsOf(nodes, node) : [];
  let ofTaggedArm: any[] | undefined = undefined;
  let leftByTaggedArm = before;
  if (tags.length !== 0) {
    const which = tags[1].indexOf(input[tags[0]]);
    if (which >= 0) {
      ofTaggedArm = [];
      report(nodes, tags[2][which], input, path, ofTaggedArm);
      leftByTaggedArm = room;
      room = before;
      if (ofTaggedArm.length === 0) return reportRules(node, input, path, issues);
    }
    arms = tags[3];
  }
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    const found: any[] = [];
    report(nodes, arm, input, path, found);
    const left = room;
    room = before;
    if (found.length === 0) return reportRules(node, input, path, issues);
    if (isNearArm(nodes[arm], input)) {
      ofNearArm = found;
      leftByNearArm = left;
      count++;
    }
  }
  if (ofTaggedArm !== undefined) {
    ofNearArm = ofTaggedArm;
    leftByNearArm = leftByTaggedArm;
    count = 1;
  }
  if (count === 1) {
    for (let i = 0; i < ofNearArm.length; i++) issues.push(ofNearArm[i]);
    room = leftByNearArm;
    return;
  }
  if (count === 0 && tags.length !== 0) return add(issues, withKey(path, tags[0]), "invalid_value", tags[4], input[tags[0]], node[4]);
  add(issues, path, count > 1 ? "invalid_union" : "invalid_type", expectedOf(nodes, at), input, node[4]);
}

let reported: any[] | undefined;

function reportOnce(nodes: any[], at: number, input: any, path: any[], issues: any[]): void {
  const memory = (reported ??= [new Map()]);
  let known = recall(memory, at, input);
  if (known === undefined) {
    const before = room;
    room = MOST_ISSUES;
    known = [[], 0];
    reportUnion(nodes, at, input, [], known[0]);
    known[1] = MOST_ISSUES - room;
    room = before;
    remember(memory, at, input, known);
  }
  addUnder(path, known[0], known[1], issues);
}

function reportUnder(path: any[], nodes: any[], at: number, input: any, issues: any[]): void {
  const before = room;
  const found: any[] = [];
  report(nodes, at, input, [], found);
  if (found.length !== 0) issues.push([path, found, before - room]);
}

function addUnder(path: any[], found: any[], count: number, issues: any[]): void {
  const taken = Math.min(count, room);
  if (taken === 0) return;
  issues.push([path, found, taken]);
  room -= taken;
}

function addWithWholePaths(found: any[], most: number, path: any[], issues: any[]): void {
  const end = issues.length + most;
  for (let i = 0; i < found.length && issues.length < end; i++) {
    const one = found[i];
    if (!Array.isArray(one)) {
      issues.push({ ...one, path: [...path, ...one.path] });
      continue;
    }
    const length = path.length;
    for (let j = 0; j < one[0].length; j++) path.push(one[0][j]);
    addWithWholePaths(one[1], Math.min(one[2], end - issues.length), path, issues);
    path.length = length;
  }
}

export function issuesOf(plan: any[], value: any): any[] {
  const found: any[] = [];
  const outer = reported;
  const outerRoom = room;
  reported = undefined;
  room = MOST_ISSUES;
  try {
    report(plan[1], plan[0], value, [], found);
    if (found.length === 0) add(found, [], "invalid_type", expectedOf(plan[1], plan[0]), value, null);
  } finally {
    reported = outer;
    room = outerRoom;
  }
  const issues: any[] = [];
  addWithWholePaths(found, MOST_ISSUES, [], issues);
  return issues;
}

function reportBelow(nodes: any[], at: number, input: any, path: any[], found: any[] | undefined, count: number, issues: any[]): void {
  if (found === undefined) return report(nodes, at, input, path, issues);
  addUnder(path, found, count, issues);
}

export function preparePlan(text: string, pending: any[]): any[] {
  const plan = JSON.parse(text);
  plan.push(pending);
  return plan;
}

export function recordFailure(plan: any[], at: number, position: number, value: any, compiled: any): void {
  const pending = plan[2];
  const found = pending[0];
  const count = pending[1];
  pending[0] = undefined;
  const nodes = plan[1];
  const node = nodes[at];
  const issues: any[] = [];
  const outer = reported;
  const outerRoom = room;
  reported = undefined;
  room = MOST_ISSUES;
  try {
    if (node[0] === 5) {
      reportBelow(nodes, node[1], value[position], [position], found, count, issues);
      reportElements(pending, compiled, nodes, node, position + 1, value, undefined, issues);
    } else if (!isPlainObject(value)) {
      report(nodes, at, value, [], issues);
    } else {
      const members = node[1];
      if (position < members.length) {
        const member = members[position];
        const given = memberOf(value, member);
        if (isMissing(value, member, given)) add(issues, [member[0]], "invalid_type", expectedOf(nodes, member[1]), undefined, nodes[member[1]][4]);
        else reportBelow(nodes, member[1], given, [member[0]], found, count, issues);
      }
      reportMembersWith(pending, compiled, nodes, node, position + 1, value, [], issues);
    }
  } finally {
    pending[1] = MOST_ISSUES - room;
    reported = outer;
    room = outerRoom;
  }
  pending[0] = issues;
}

export function takeIssues(plan: any[], value: any): any[] {
  const pending = plan[2];
  const found = pending[0];
  pending[0] = undefined;
  if (found === undefined || found.length === 0) return issuesOf(plan, value);
  const issues: any[] = [];
  addWithWholePaths(found, pending[1], [], issues);
  return issues;
}

export function failureWithIssues(plan: any[], value: any): any {
  return { success: false, issues: issuesOf(plan, value) };
}

function errorWith(issues: any[]): any {
  const first = issues[0];
  const error: any = new TypeError((first.path.length ? first.path.join(".") + ": " : "") + first.message);
  error.issues = issues;
  return error;
}

export function throwIssues(issues: any[]): never {
  throw errorWith(issues);
}

let parsedSchemas: Map<string, any[]> | undefined;

export function __validate(value: any, schema: string, isShared?: boolean): any {
  let plan = (parsedSchemas ??= new Map()).get(schema);
  if (plan === undefined) parsedSchemas.set(schema, (plan = JSON.parse(schema) as any[]));
  if (isShared) value = copyOf(plan[1], [plan[0]], value);
  const refused: any[] = [];
  const made = build(plan[1], plan[0], value, refused, holdsDefault(plan));
  if (made !== refused) return made;
  const error = errorWith(issuesOf(plan, value));
  (Error as any).captureStackTrace?.(error, __validate);
  throw error;
}

export function validateByPlan(plan: any[], value: any): any {
  const refused: any[] = [];
  value = copyOf(plan[1], [plan[0]], value);
  const made = build(plan[1], plan[0], value, refused, holdsDefault(plan));
  return made === refused ? throwIssues(issuesOf(plan, value)) : made;
}

export function safeValidateByPlan(plan: any[], value: any): any {
  const refused: any[] = [];
  value = copyOf(plan[1], [plan[0]], value);
  const made = build(plan[1], plan[0], value, refused, holdsDefault(plan));
  return made === refused ? failureWithIssues(plan, value) : { success: true, data: made };
}

export function planSchema(plan: any[]): any {
  return {
    "~standard": {
      version: 1,
      vendor: "bun",
      validate(value: any): any {
        const refused: any[] = [];
        value = copyOf(plan[1], [plan[0]], value);
        const made = build(plan[1], plan[0], value, refused, holdsDefault(plan));
        return made === refused ? { issues: issuesOf(plan, value) } : { value: made };
      },
    },
  };
}
