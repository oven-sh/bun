function receivedOf(value: any): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && !Number.isFinite(value)) return Number.isNaN(value) ? "nan" : "infinity";
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
    case 9:
      return node[1].map((arm: number) => expectedOf(nodes, arm)).join(" | ");
    case 10:
      return "undefined";
    default:
      return "object";
  }
}

function isPlainObject(value: any): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      const checked = [];
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
  const received = receivedOf(value);
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
    switch (rule[0]) {
      case "int":
        add(issues, path, "invalid_type", "int", value, node[4]);
        break;
      case "min":
        add(issues, path, "too_small", "number to be >=" + rule[1], value, node[4]);
        break;
      case "max":
        add(issues, path, "too_big", "number to be <=" + rule[1], value, node[4]);
        break;
      case "above":
        add(issues, path, "too_small", "number to be >" + rule[1], value, node[4]);
        break;
      case "below":
        add(issues, path, "too_big", "number to be <" + rule[1], value, node[4]);
        break;
      case "multipleOf":
        add(issues, path, "not_multiple_of", "multiple of " + rule[1], value, node[4]);
        break;
      case "minLength":
        add(
          issues,
          path,
          "too_small",
          items ? "array to have >=" + rule[1] + " items" : "string to have >=" + rule[1] + " characters",
          value,
          node[4],
        );
        break;
      case "maxLength":
        add(
          issues,
          path,
          "too_big",
          items ? "array to have <=" + rule[1] + " items" : "string to have <=" + rule[1] + " characters",
          value,
          node[4],
        );
        break;
      case "pattern":
        add(issues, path, "invalid_format", "string to match /" + rule[1] + "/", value, node[4]);
        break;
      default:
        add(issues, path, "invalid_format", rule[2], value, node[4]);
    }
  }
}

function report(nodes: any[], at: number, input: any, path: any[], issues: any[], refused: object): void {
  const node = nodes[at];
  if (node[5] && input === undefined) input = node[6];
  switch (node[0]) {
    case 0:
      return;
    case 1:
      return add(issues, path, "invalid_type", "never", input, node[4]);
    case 2:
      if (typeof input !== node[1] || (node[1] === "number" && !Number.isFinite(input)))
        return add(issues, path, "invalid_type", node[1], input, node[4]);
      return reportRules(node, input, path, issues);
    case 3:
      if (input !== node[1]) add(issues, path, "invalid_value", JSON.stringify(node[1]), input, node[4]);
      return;
    case 10:
      if (input !== undefined) add(issues, path, "invalid_value", "undefined", input, node[4]);
      return;
    case 4:
      if (typeof input !== "object" || input === null) add(issues, path, "invalid_type", "object", input, node[4]);
      return;
    case 5:
      if (!Array.isArray(input)) return add(issues, path, "invalid_type", "array", input, node[4]);
      reportRules(node, input, path, issues);
      for (let i = 0; i < input.length; i++) report(nodes, node[1], input[i], [...path, i], issues, refused);
      return;
    case 6: {
      const elements = node[1];
      if (!Array.isArray(input) || input.length !== elements.length)
        return add(issues, path, "invalid_type", "tuple", input, node[4]);
      for (let i = 0; i < elements.length; i++) report(nodes, elements[i], input[i], [...path, i], issues, refused);
      return;
    }
    case 7: {
      if (!isPlainObject(input)) return add(issues, path, "invalid_type", "object", input, node[4]);
      const keys = Object.keys(input);
      for (let i = 0; i < keys.length; i++) report(nodes, node[1], input[keys[i]], [...path, keys[i]], issues, refused);
      return;
    }
    case 8: {
      if (!isPlainObject(input)) return add(issues, path, "invalid_type", "object", input, node[4]);
      const members = node[1];
      for (let i = 0; i < members.length; i++) {
        if (members[i][2] !== 2)
          report(nodes, members[i][1], input[members[i][0]], [...path, members[i][0]], issues, refused);
      }
      if (node[2] === -1) return;
      const keys = Object.keys(input);
      for (let i = 0; i < keys.length; i++) {
        if (isDeclared(members, keys[i])) continue;
        if (node[2] === -2) add(issues, path, "unrecognized_keys", JSON.stringify(keys[i]), input, node[4]);
        else report(nodes, node[2], input[keys[i]], [...path, keys[i]], issues, refused);
      }
      return;
    }
    default: {
      const made = build(nodes, at, input, refused);
      if (made !== refused) return;
      const arms = node[1];
      let near = -1;
      let count = 0;
      for (let i = 0; i < arms.length; i++) {
        const arm = nodes[arms[i]];
        const kind = arm[0];
        const isNear =
          kind === 2
            ? typeof input === arm[1] && (arm[1] !== "number" || Number.isFinite(input))
            : kind === 5 || kind === 6
              ? Array.isArray(input)
              : kind === 7 || kind === 8
                ? isPlainObject(input)
                : false;
        if (isNear) {
          near = arms[i];
          count++;
        }
      }
      if (count === 1) {
        const before = issues.length;
        report(nodes, near, input, path, issues, refused);
        if (issues.length > before) return;
      }
      add(issues, path, count > 1 ? "invalid_union" : "invalid_type", expectedOf(nodes, at), input, node[4]);
    }
  }
}

function issuesOf(plan: any[], value: any): any[] {
  const issues: any[] = [];
  report(plan[1], plan[0], value, [], issues, {});
  if (issues.length === 0)
    throw new Error("Internal error: a value was refused by its type and no issue was found. This is a bug in Bun.");
  return issues;
}

export function failureWithIssues(plan: any[], value: any): any {
  return { success: false, issues: issuesOf(plan, value) };
}

export function throwIssues(plan: any[], value: any): never {
  const issues = issuesOf(plan, value);
  const first = issues[0];
  const error: any = new TypeError((first.path.length ? first.path.join(".") + ": " : "") + first.message);
  error.issues = issues;
  throw error;
}

export function validateByPlan(plan: any[], value: any): any {
  const refused = {};
  const made = build(plan[1], plan[0], value, refused);
  return made === refused ? throwIssues(plan, value) : made;
}

export function safeValidateByPlan(plan: any[], value: any): any {
  const refused = {};
  const made = build(plan[1], plan[0], value, refused);
  return made === refused ? failureWithIssues(plan, value) : { success: true, data: made };
}

export function schemaOfPlan(plan: any[]): any {
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
