// Writes a rule's options as a `bunfig.toml` snippet, with every option set to its default. Used by `lint-rule-docs.ts`.
//
// The names, types and allowed values come from the rule's JSON schema. A default comes from, in this order:
//
// 1. `default_options` in `bun lint --rules -f json`
// 2. `default` in the schema
// 3. the "## Options" part of the rule's page: the `Default` column of a table, or a value the text calls the default
//
// An option without a default is commented out, so the snippet as a whole never changes what the rule does.
// `test/cli/lint/rule-docs.test.ts` checks that.
//
// The layout is what `bun fmt` prints, so pasting a snippet into a formatted `bunfig.toml` keeps `bun fmt --check`
// green. The same test checks that too.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = { [key: string]: any };

// Fits an 80-column terminal, next to the frame that `bun lint --explain` draws around code.
export const WIDTH = 78;
// `bun fmt` puts a list on one line if it fits in `printWidth`. Comments don't count.
const PRINT_WIDTH = 80;

export const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isEmpty = (value: Json) => value === "" || (typeof value === "object" && !Object.keys(value!).length);
const same = (a: unknown, b: unknown) => Bun.deepEquals(a, b, true);
/** TOML has no `null`, so a default with a `null` in it can't be written down. */
const hasNull = (value: unknown): boolean =>
  value === null || (typeof value === "object" && Object.values(value as object).some(hasNull));
const typeOf = (value: unknown) =>
  Array.isArray(value) ? "array" : value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value;
const oneOf = (items: string[]) =>
  items.length < 2 ? items.join() : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;

const tomlKey = (key: string) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key));
const tomlTable = (entries: [string, Json][]) =>
  entries.length ? `{ ${entries.map(([key, value]) => `${tomlKey(key)} = ${toml(value)}`).join(", ")} }` : "{}";
/** `value` as TOML, on one line. A JSON string is also a valid TOML string. */
const toml = (value: Json): string =>
  Array.isArray(value)
    ? `[${value.map(toml).join(", ")}]`
    : isObject(value)
      ? tomlTable(Object.entries(value))
      : JSON.stringify(value);

/** Facts about the options, parsed from the hand-written "## Options" part of a page. */
export type Documented = {
  /**
   * Rows of the `Option | Default | ...` tables: the option's name, and its default if that cell is JSON in backticks.
   * A default that depends on another option ends in: otherwise `"it"`.
   */
  options: Map<string, Json | undefined>;
  /** First column of the `Option | What it does` tables. They describe an option that's one of a few values. */
  choices: Json[];
  /** Values the text calls the default, as in `"always"` (default), or: The default is `"always"`. */
  defaults: Json[];
};

export function documentedIn(body: string): Documented {
  const found: Documented = { options: new Map(), choices: [], defaults: [] };
  const json = (code = "") => {
    try {
      return JSON.parse(/^`([^`]+)`$/.exec(code)![1]) as Json;
    } catch {
      return undefined;
    }
  };
  let hasDefaults: boolean | null = null;
  for (const line of body.split("\n")) {
    if (!line.startsWith("|")) hasDefaults = null;
    else if (hasDefaults === null)
      hasDefaults = line.startsWith("| Option |") ? line.startsWith("| Option | Default |") : null;
    else {
      const cells = line
        .slice(1)
        .split(/(?<!\\)\|/)
        .map(cell => cell.trim().replaceAll("\\|", "|"));
      const name = /^`([^`]+)`$/.exec(cells[0])?.[1];
      if (hasDefaults && name) found.options.set(name, json(/(?:^|, otherwise )(`[^`]+`)$/.exec(cells[1])?.[1]));
      const choice = json(/^`[^`]+`/.exec(cells[0])?.[0]);
      if (!hasDefaults && choice !== undefined) found.choices.push(choice);
    }
  }
  for (const [, before, after] of body.matchAll(/(`[^`]+`) \(default\)|\bdefault is (`[^`]+`)/g)) {
    const value = json(before ?? after);
    if (value !== undefined) found.defaults.push(value);
  }
  return found;
}

/**
 * Rules ported from oxlint have no schema, but their pages say what the options are. The examples show the shape, and the
 * tables have the names and the defaults.
 */
export function inferredSchema(documented: Documented, examples: { options: unknown[] }[]): Schema[] | null {
  const used = examples.map(it => it.options as Json[]).filter(it => it.length);
  const longest = used.toSorted((a, b) => b.length - a.length)[0] ?? [];
  const typeOfAll = (values: Json[]) => {
    const types = new Set(values.map(typeOf));
    return types.size === 1 ? [...types][0] : undefined;
  };
  const schema = longest.map((_, i): Schema | null => {
    const values = used.flatMap(it => (i < it.length ? [it[i]] : []));
    if (!values.some(isObject)) return documented.choices.length ? { enum: documented.choices } : null;
    const names = [...documented.options.keys()];
    if (!names.length || !values.every(it => isObject(it) && Object.keys(it).every(key => names.includes(key))))
      return null;
    // An example only shows one value that works, so it says nothing about the type. It's good enough for what goes in a list.
    const properties = names.map(name => {
      const value = documented.options.get(name);
      const lists = [value, ...values.map(it => (it as Record<string, Json>)[name])].filter(it => it !== undefined);
      if (lists.length && lists.every(Array.isArray))
        return [name, { type: "array", items: { type: typeOfAll(lists.flat()) } }];
      return [name, { type: value === undefined ? undefined : typeOf(value) }];
    });
    return { type: "object", properties: Object.fromEntries(properties) };
  });
  return schema.length && schema.every(it => it !== null) ? (schema as Schema[]) : null;
}

/** Follows `$ref` and merges `allOf`. */
function resolve(schema: Schema, root: Schema): Schema {
  while (schema.$ref)
    schema = schema.$ref
      .slice(2)
      .split("/")
      .reduce((at: any, key: string) => at[key], root);
  if (!schema.allOf) return schema;
  const parts: Schema[] = schema.allOf.map((it: Schema) => resolve(it, root)).filter((it: Schema) => !it.not);
  return { ...Object.assign({}, ...parts), properties: Object.assign({}, ...parts.map(it => it.properties)) };
}

/** `anyOf` and `oneOf`, flattened. If `schema` has properties of its own, its alternatives only add constraints. */
function alternatives(schema: Schema, root: Schema): Schema[] {
  schema = resolve(schema, root);
  const list: Schema[] | undefined = schema.anyOf ?? schema.oneOf;
  if (!list || schema.properties) return [schema];
  const { anyOf, oneOf, ...rest } = schema;
  return list.flatMap(it => alternatives({ ...rest, ...resolve(it, root) }, root));
}

/** Enough of JSON Schema to choose between alternatives. The test runs `bun lint` for the real validation. */
function accepts(schema: Schema, value: Json, root: Schema): boolean {
  schema = resolve(schema, root);
  const ok = (it: Schema) => accepts(it, value, root);
  const type = typeOf(value);
  if (schema.type && ![schema.type].flat().some(it => it === type || (it === "number" && type === "integer")))
    return false;
  if (schema.enum && !schema.enum.some((it: Json) => same(it, value))) return false;
  if ("const" in schema && !same(schema.const, value)) return false;
  if (schema.anyOf && !schema.anyOf.some(ok)) return false;
  if (schema.oneOf && schema.oneOf.filter(ok).length !== 1) return false;
  if (schema.not && ok(schema.not)) return false;
  if (typeof value === "number" && (value < (schema.minimum ?? value) || value > (schema.maximum ?? value)))
    return false;
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return false;
    const isTuple = Array.isArray(schema.items);
    if (isTuple && schema.additionalItems === false && value.length > schema.items.length) return false;
    return value.every((it, i) => accepts((isTuple ? schema.items[i] : schema.items) ?? {}, it, root));
  }
  if (!isObject(value)) return true;
  if (schema.required?.some((key: string) => !(key in value))) return false;
  return Object.entries(value).every(([key, it]) =>
    schema.properties?.[key]
      ? accepts(schema.properties[key], it, root)
      : schema.additionalProperties !== false || schema.patternProperties !== undefined,
  );
}

/**
 * The values `schema` accepts, as a list to join with "or": `"always"`, `"never"`, `number`, `list of strings`.
 * `short` names the type of an enum instead of its values.
 */
function kinds(schema: Schema, root: Schema, short = false): string[] {
  const all = alternatives(schema, root).flatMap(it => {
    const values: Json[] | undefined = it.enum ?? ("const" in it ? [it.const] : undefined);
    if (values) return values.map(value => (short ? typeof value : JSON.stringify(value)));
    return [it.type ?? (it.properties ? "object" : [])].flat().flatMap((type: string) => {
      if (type === "boolean") return ["true", "false"];
      if (type === "integer") return ["number"];
      if (type === "null") return [];
      if (type !== "array") return [type];
      const items = isObject(it.items) ? kinds(it.items, root, short) : [];
      if (!items.length) return ["list"];
      if (items.every(item => /^[a-z]+$/.test(item))) return [`list of ${oneOf(items.map(item => `${item}s`))}`];
      return [items.every(item => item.startsWith('"')) ? `list of ${oneOf(items)}` : "list"];
    });
  });
  return [...new Set(all)];
}

/** A line of the snippet. `hints` are comments for it, best first. The first one that fits is used. */
type Line = { text: string; hints?: string[] };

const isOff = (line: Line) => line.text.trimStart().startsWith("#");
const off = (lines: Line[], indent: string) =>
  lines.map(it => (isOff(it) ? it : { ...it, text: `${indent}# ${it.text.slice(indent.length)}` }));

/** Says which values an enum has, or what goes into an empty default. Anything else is clear from the default itself. */
function hintsFor(schema: Schema, value: Json, root: Schema) {
  const all = kinds(schema, root);
  if (isEmpty(value))
    return [oneOf(all), oneOf(kinds(schema, root, true))].filter(it => it && !/^(list|object)$/.test(it));
  return all.length > 1 && all.some(it => it.startsWith('"')) ? [oneOf(all)] : [];
}

/** Stands in for a value that has no default: `<number>`, `<"always" or "never">`. */
function placeholder(before: string, schemas: Schema[], root: Schema) {
  const [long, short] = [false, true].map(short => [...new Set(schemas.flatMap(it => kinds(it, root, short)))]);
  if (long.length === 1 && long[0].startsWith('"')) return `${before}${long[0]},`;
  const line = `${before}<${oneOf(long) || "value"}>,`;
  return line.length <= WIDTH ? line : `${before}<${oneOf(short)}>,`;
}

/** `before` + `value` + `,`. A list that doesn't fit on the line gets one item per line. */
function entry(before: string, value: Json, indent: string): string[] {
  const line = `${indent}${before}${toml(value)},`;
  if (line.length <= PRINT_WIDTH || !Array.isArray(value)) return [line];
  return [`${indent}${before}[`, ...value.flatMap(item => entry("", item, `${indent}  `)), `${indent}],`];
}

/** Puts each hint after its line, or above it if that's too long. Options with the same long hint only get it once. */
function withHints(lines: Line[]) {
  const seen = new Set<string>();
  return lines.flatMap(({ text, hints = [] }) => {
    const after = hints.map(it => `${text} # ${it}`).find(it => it.length <= WIDTH);
    if (after) return [after];
    const above = hints.map(it => `${/^ */.exec(text)![0]}# ${it}`).find(it => it.length <= WIDTH);
    if (!above || seen.has(above)) return [text];
    seen.add(above);
    return [above, text];
  });
}

class Writer {
  /** The options that the lines written so far set. */
  value: Json[] = [];
  constructor(
    readonly root: Schema,
    readonly defaults: Json[],
    readonly documented: Documented,
    /** Options to comment out even though they have a default. */
    readonly unset: string[],
  ) {}

  /** One line for each property of an object. `others` are alternatives to `schema`. Their properties are commented out. */
  properties(schema: Schema, known: Record<string, Json>, path: string, indent: string, others: Schema[] = []) {
    const { root, documented } = this;
    const [lines, value]: [Line[], Record<string, Json>] = [[], {}];
    // Same order as in the table on the page.
    const order = [...documented.options.keys()].map(it => it.slice(path.length));
    const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
    const names = Object.keys(schema.properties ?? {}).sort((a, b) => rank(a) - rank(b));
    for (const name of names) {
      const property = resolve(schema.properties[name], root);
      const before = `${tomlKey(name)} = `;
      let set = known[name] ?? property.default ?? documented.options.get(path + name);
      if (hasNull(set) || (set !== undefined && !accepts(property, set, root))) set = undefined;
      const nested = alternatives(property, root).filter(it => it.properties);
      if (set === undefined) lines.push({ text: placeholder(`${indent}# ${before}`, [property], root) });
      else if (this.unset.includes(path + name)) {
        const [first, ...rest] = entry(before, set, indent);
        lines.push(
          ...off([{ text: first, hints: hintsFor(property, set, root) }, ...rest.map(text => ({ text }))], indent),
        );
      } else if (isObject(set) && nested.length === 1) {
        const inner = this.properties(nested[0], set, `${path}${name}.`, `${indent}  `);
        value[name] = inner.value;
        const [line] = entry(before, inner.value, indent);
        if (line.length <= PRINT_WIDTH && inner.lines.every(it => !it.hints?.length && !isOff(it)))
          lines.push({ text: line });
        else lines.push({ text: `${indent}${before}{` }, ...inner.lines, { text: `${indent}},` });
      } else {
        value[name] = set;
        const [first, ...rest] = entry(before, set, indent);
        lines.push({ text: first, hints: hintsFor(property, set, root) }, ...rest.map(text => ({ text })));
      }
    }
    for (const other of others) {
      const rest = Object.entries(other.properties ?? {}).filter(([name]) => !names.includes(name));
      names.push(...rest.map(it => it[0]));
      lines.push(...off(this.properties({ properties: Object.fromEntries(rest) }, {}, path, indent).lines, indent));
    }
    return { lines, value };
  }

  /**
   * The option at `index`, which matches one of `choices`. `plainInAnyShape` is for the hint.
   * `null` if the default doesn't match any of them, or if there's nothing to show.
   */
  option(choices: Schema[], index: number, isRequired: boolean, plainInAnyShape: Schema[]): Line[] | null {
    const { root, documented } = this;
    const objects = choices.filter(it => it.properties || it.type === "object");
    const plain = choices.filter(it => !objects.includes(it));
    const names = (it: Schema) => Object.keys(it.properties ?? {});
    const best = (list: Schema[], score: (it: Schema) => number) => list.toSorted((a, b) => score(b) - score(a)).at(0);
    const defaultOf = (it: Schema, name: string) =>
      resolve(it.properties[name], root).default ?? documented.options.get(name);
    let known: Json | undefined = this.defaults[index];
    let object: Schema | undefined;
    if (isObject(known))
      object = best(
        objects.filter(it => accepts({ ...it, required: [] }, known!, root)),
        it => names(it).length,
      );
    else if (known !== undefined) {
      // `20` is short for `{ max = 20 }` if 20 is the default of `max`. The long form has room for the other options.
      object = objects.find(it => names(it).some(name => same(defaultOf(it, name), known)));
      if (!object && !plain.some(it => accepts(it, known!, root))) return null;
    } else {
      known = documented.defaults.find(value => plain.some(it => accepts(it, value, root)));
      known ??= plain.find(it => it.default !== undefined)?.default;
      if (isRequired) known ??= plain.find(it => it.enum)?.enum[0];
      // The default shape is the one that can hold the documented defaults.
      const fit = (it: Schema) =>
        names(it).reduce((sum, name) => {
          const value = defaultOf(it, name);
          return value === undefined ? sum : sum + (accepts(it.properties[name], value, root) ? 100 : -10000);
        }, names(it).length);
      if (known === undefined) object = best(objects, fit);
    }
    if (object) {
      const stated = documented.defaults.filter(it => isObject(it) && accepts(object, it, root));
      const set = Object.assign({}, ...stated, isObject(known) ? known : {});
      const { lines, value } = this.properties(
        object,
        set,
        "",
        "    ",
        objects.filter(it => it !== object),
      );
      if (!lines.length) return null;
      this.value.push(value);
      return [{ text: "  {" }, ...lines, { text: "  }," }];
    }
    if (known === undefined || hasNull(known)) return [{ text: placeholder("  # ", plainInAnyShape, root) }];
    this.value.push(known);
    const [first, ...rest] = entry("", known, "  ");
    return [{ text: first, hints: hintsFor({ anyOf: plainInAnyShape }, known, root) }, ...rest.map(text => ({ text }))];
  }
}

export type Snippet = {
  /** `"<rule>" = [<severity>, ...]` */
  lines: string[];
  /** The options that `lines` set. */
  options: Json[];
  /** Some options are commented out. */
  hasUnset: boolean;
  /** The rule is a config error without options, so these aren't defaults. */
  isRequired: boolean;
};

/** `null` if the schema is too irregular to show the options this way, like a list of any length. */
export function optionsSnippet(
  id: string,
  severity: string,
  schema: Schema | Schema[],
  defaults: Json[],
  documented: Documented,
  unset: string[] = [],
): Snippet | null {
  const root: Schema = Array.isArray(schema) ? { type: "array", items: schema } : schema;
  const isRequired = !accepts(root, [], root);
  const start = `${JSON.stringify(id)} = [`;
  // One shape for each way to write the options, like `["always", { .. }]` and `["never"]`. Show the longest that works.
  const shapes = alternatives(root, root).filter(it => Array.isArray(it.items));
  const longest = (unset: string[]) => {
    let best: { lines: Line[]; options: Json[] } | undefined;
    for (const shape of shapes) {
      const writer = new Writer(root, defaults, documented, unset);
      const lines: Line[] = [];
      for (let i = 0; i < shape.items.length; i++) {
        const plain = shapes.flatMap(it =>
          alternatives(it.items[i] ?? { properties: {} }, root).filter(it => !it.properties),
        );
        const option = writer.option(alternatives(shape.items[i], root), i, i < (shape.minItems ?? 0), plain);
        lines.push(...(option ?? []));
        if (writer.value.length > i) continue;
        // Nothing can follow an option that's commented out, so the rest wouldn't show up at all.
        if (option && i < shape.items.length - 1) lines.length = 0;
        break;
      }
      if (lines.length > (best?.lines.length ?? 0) && accepts(root, writer.value, root))
        best = { lines, options: writer.value };
    }
    return best;
  };
  let best = longest(unset);
  // Some options exclude each other, like a new name and the old one. If all the defaults together are invalid, leave out
  // the option that the page lists last, or else the one before it, and so on.
  for (const name of [...documented.options.keys()].reverse()) best ??= longest([...unset, name]);
  if (!best) {
    // A list of any length with a default, like `"consistent-this" = ["error", "that"]`.
    if (!defaults.length || !defaults.every(it => it !== null && typeof it !== "object")) return null;
    const line = `${start}${[severity, ...defaults].map(toml).join(", ")}]`;
    return { lines: [line], options: defaults, hasUnset: false, isRequired };
  }
  const { lines } = best;
  const hasUnset = lines.some(isOff);
  const done = (lines: string[]) => ({ lines, options: best.options, hasUnset, isRequired });
  const exploded = withHints([{ text: start }, { text: `  ${toml(severity)},` }, ...lines, { text: "]" }]);
  const table = lines.findIndex(it => it.text === "  {");
  const plain = lines.slice(0, table < 0 ? lines.length : table);
  // A comment between the brackets keeps one value per line. Without one, `bun fmt` joins whatever fits.
  const hasHints = withHints(plain).join("\n") !== plain.map(it => it.text).join("\n");
  // A single value's hint can go behind the `]`.
  const only = `${start}${toml(severity)}, ${lines[0].text.trim().slice(0, -1)}]`;
  if (lines.length === 1 && !hasUnset && only.length <= (hasHints ? WIDTH : PRINT_WIDTH))
    return done(withHints([{ ...lines[0], text: only }]));
  if (hasHints || plain.some(it => isOff(it) || !it.text.endsWith(","))) return done(exploded);
  const head = [toml(severity), ...plain.map(it => it.text.trim().slice(0, -1))].join(", ");
  if (table < 0) return done(`${start}${head}]`.length <= PRINT_WIDTH ? [`${start}${head}]`] : exploded);
  // `bun fmt` hugs a table in last position: `["error", {` .. `}]`.
  if (lines.findIndex(it => it.text === "  },") < lines.length - 1 || `${start}${head}, {`.length > PRINT_WIDTH)
    return done(exploded);
  const inner = lines.slice(table + 1, -1).map(it => ({ ...it, text: it.text.slice(2) }));
  return done(withHints([{ text: `${start}${head}, {` }, ...inner, { text: "}]" }]));
}
