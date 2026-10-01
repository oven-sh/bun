// Research probe: port of the configuration functions of internal/testutil/harnessutil/harnessutil.go.
import { enumMapOf, getCommandLineOption } from "./options";

export type TestConfiguration = Map<string, string>;
export interface NamedTestConfiguration {
  name: string;
  config: TestConfiguration;
}
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

// Go's unicode.IsSpace for the Latin-1 range plus the other spaces, as strings.TrimSpace uses.
function isGoSpace(ch: number): boolean {
  switch (ch) {
    case 0x09: case 0x0a: case 0x0b: case 0x0c: case 0x0d: case 0x20: case 0x85: case 0xa0:
    case 0x1680: case 0x2028: case 0x2029: case 0x202f: case 0x205f: case 0x3000:
      return true;
  }
  return ch >= 0x2000 && ch <= 0x200a;
}
export function trimSpace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isGoSpace(s.charCodeAt(start))) start++;
  while (end > start && isGoSpace(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

// harnessutil.go:1026-1036; keys sort by bytes, which for ASCII names equals the code unit order.
export function getFileBasedTestConfigurationDescription(config: TestConfiguration): string {
  const keys = [...config.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let output = "";
  keys.forEach((key, i) => {
    if (i > 0) output += ",";
    output += `${key}=${config.get(key)!.toLowerCase()}`;
  });
  return output;
}

type OptionValue = string | number | boolean;

// harnessutil.go:1158-1180
export function tryGetValueOfOptionString(option: string, value: string): { value: OptionValue; ok: boolean } {
  const optionDecl = getCommandLineOption(option);
  if (optionDecl === undefined) return { value: "", ok: false };
  switch (optionDecl.kind) {
    case "Enum": {
      const hit = enumMapOf(optionDecl)?.find(([k]) => k === value.toLowerCase());
      if (hit === undefined) return { value: "", ok: false };
      return { value: hit[1], ok: true };
    }
    case "Boolean":
      switch (value.toLowerCase()) {
        case "true": return { value: true, ok: true };
        case "false": return { value: false, ok: true };
      }
      return { value: "", ok: false };
  }
  return { value, ok: true };
}

// harnessutil.go:1188-1200
export function getAllValuesForOption(option: string): string[] {
  const optionDecl = getCommandLineOption(option);
  if (optionDecl === undefined) return [];
  switch (optionDecl.kind) {
    case "Enum": return (enumMapOf(optionDecl) ?? []).map(([k]) => k);
    case "Boolean": return ["true", "false"];
  }
  return [];
}

// harnessutil.go:1085-1148; the reference returns the values in the order of a Go map, this port in the order of insertion.
export function splitOptionValues(value: string, option: string): Result<string[]> {
  if (value.length === 0) return { ok: true, value: [] };
  let star = false;
  const includes: string[] = [];
  const excludes: string[] = [];
  for (let s of value.split(",")) {
    s = trimSpace(s);
    if (s.length === 0) continue;
    if (s === "*") star = true;
    else if (s.startsWith("-") || s.startsWith("!")) excludes.push(s.slice(1));
    else includes.push(s);
  }
  if (includes.length === 0 && !star && excludes.length === 0) return { ok: true, value: [] };

  const variations = new Map<OptionValue, string>();
  for (const include of includes) {
    const v = tryGetValueOfOptionString(option, include);
    if (!v.ok) return { ok: false, reason: `Unknown value '${include}' for option '${option}'` };
    if (!variations.has(v.value)) variations.set(v.value, include);
  }
  const allValues = getAllValuesForOption(option);
  if (star && allValues.length > 0) {
    for (const include of allValues) {
      const v = tryGetValueOfOptionString(option, include);
      if (!v.ok) return { ok: false, reason: `Unknown value '${include}' for option '${option}'` };
      if (!variations.has(v.value)) variations.set(v.value, include);
    }
  }
  for (const exclude of excludes) {
    const v = tryGetValueOfOptionString(option, exclude);
    if (!v.ok) continue;
    variations.delete(v.value);
  }
  if (variations.size === 0) {
    return { ok: false, reason: `Variations in test option '@${option}' resulted in an empty set.` };
  }
  return { ok: true, value: [...variations.values()] };
}

// harnessutil.go:1038-1074; options are visited in sorted order, where the reference visits a Go map.
export function getFileBasedTestConfigurations(
  settings: Map<string, string>,
  varyByOptions: Set<string>,
): Result<NamedTestConfiguration[]> {
  const optionEntries: string[][] = [];
  let variationCount = 1;
  const nonVaryingOptions: TestConfiguration = new Map();
  const options = [...settings.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const option of options) {
    const value = settings.get(option)!;
    if (varyByOptions.has(option)) {
      const entries = splitOptionValues(value, option);
      if (!entries.ok) return entries;
      if (entries.value.length > 1) {
        variationCount *= entries.value.length;
        if (variationCount > 25) {
          return { ok: false, reason: "Provided test options exceeded the maximum number of variations" };
        }
        optionEntries.push([option, ...entries.value]);
      } else if (entries.value.length === 1) {
        nonVaryingOptions.set(option, entries.value[0]);
      }
    } else {
      nonVaryingOptions.set(option, value);
    }
  }

  const configurations: NamedTestConfiguration[] = [];
  if (optionEntries.length > 0) {
    const varying: TestConfiguration[] = [];
    computeFileBasedTestConfigurationVariationsWorker(varying, optionEntries, 0, new Map());
    for (const varyingConfig of varying) {
      const description = getFileBasedTestConfigurationDescription(varyingConfig);
      for (const [k, v] of nonVaryingOptions) varyingConfig.set(k, v);
      configurations.push({ name: description, config: varyingConfig });
    }
  } else if (nonVaryingOptions.size > 0) {
    configurations.push({ name: "", config: nonVaryingOptions });
  }
  return { ok: true, value: configurations };
}

function computeFileBasedTestConfigurationVariationsWorker(
  configurations: TestConfiguration[],
  optionEntries: string[][],
  index: number,
  variationState: TestConfiguration,
): void {
  if (index >= optionEntries.length) {
    configurations.push(new Map(variationState));
    return;
  }
  const optionKey = optionEntries[index][0];
  for (const entry of optionEntries[index].slice(1)) {
    variationState.set(optionKey, entry);
    computeFileBasedTestConfigurationVariationsWorker(configurations, optionEntries, index + 1, variationState);
  }
}
