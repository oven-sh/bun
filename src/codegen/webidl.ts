/** Parses as much of WebIDL (https://webidl.spec.whatwg.org/#idl-grammar) as src/runtime/webgpu/webgpu.idl has. */

export type IDLType = (
  { kind: "name"; name: string } | { kind: "generic"; name: string; of: IDLType[] } | { kind: "union"; of: IDLType[] }
) & { nullable: boolean; attributes: string[] };

export interface Argument {
  name: string;
  type: IDLType;
  optional: boolean;
  /** As the IDL writes it. */
  default?: string;
}

export type Member =
  | { kind: "attribute"; name: string; type: IDLType; readonly: boolean; attributes: string[] }
  | { kind: "operation"; name: string; returns: IDLType; args: Argument[] }
  | { kind: "constructor"; args: Argument[] }
  | { kind: "setlike"; type: IDLType }
  | { kind: "const"; name: string; value: string };

export type Definition =
  | { kind: "interface" | "mixin" | "namespace"; name: string; base?: string; members: Member[] }
  | { kind: "dictionary"; name: string; base?: string; members: Argument[] }
  | { kind: "enum"; name: string; values: string[] }
  | { kind: "typedef"; name: string; type: IDLType };

/** By name, in the order of the text. An interface has the members of its partials and of the mixins it includes. */
export function parseWebIDL(text: string): Map<string, Definition> {
  const tokens = [...text.matchAll(/\/\/.*|\/\*[^]*?\*\/|("[^"]*"|-?0x[\da-f]+|-?\d+(?:\.\d+)?|\w+|\S)/gi)].flatMap(
    match => match[1] ?? [],
  );
  let at = 0;
  const next = () => tokens[at++]!;
  const accept = (token: string) => tokens[at] === token && !!++at;
  const expect = (token: string) => {
    if (!accept(token)) throw new SyntaxError(`expected ${token} at: ${tokens.slice(at, at + 8).join(" ")}`);
  };

  /** Their names. */
  function attributes(): string[] {
    const names: string[] = [];
    if (!accept("[")) return names;
    do {
      names.push(next());
      if (accept("=")) {
        if (accept("(")) while (!accept(")")) next();
        else next();
      }
    } while (accept(","));
    expect("]");
    return names;
  }

  function type(outer: string[] = []): IDLType {
    const all = [...outer, ...attributes()];
    const done = <T>(parsed: T) => ({ ...parsed, nullable: accept("?"), attributes: all });
    if (accept("(")) {
      const of = [type()];
      while (accept("or")) of.push(type());
      expect(")");
      return done({ kind: "union" as const, of });
    }
    let name = next();
    if (name === "unsigned") name += ` ${next()}`;
    if (name.endsWith("long") && accept("long")) name += " long";
    if (!accept("<")) return done({ kind: "name" as const, name });
    const of = [type()];
    while (accept(",")) of.push(type());
    expect(">");
    return done({ kind: "generic" as const, name, of });
  }

  function defaultValue(): { default?: string } {
    if (!accept("=")) return {};
    const value = next();
    return { default: value === "[" || value === "{" ? value + next() : value };
  }

  function args(): Argument[] {
    const list: Argument[] = [];
    expect("(");
    while (!accept(")")) {
      const outer = attributes();
      const optional = accept("optional");
      list.push({ type: type(outer), name: next(), optional, ...defaultValue() });
      accept(",");
    }
    return list;
  }

  function member(): Member {
    const outer = attributes();
    if (accept("constructor")) return { kind: "constructor", args: args() };
    if (accept("const")) {
      type();
      const name = next();
      expect("=");
      return { kind: "const", name, value: next() };
    }
    const readonly = accept("readonly");
    if (tokens[at] === "setlike") return { kind: "setlike", type: type() };
    if (accept("attribute")) return { kind: "attribute", type: type(), name: next(), readonly, attributes: outer };
    return { kind: "operation", returns: type(), name: next(), args: args() };
  }

  function block<T>(item: () => T): T[] {
    const items: T[] = [];
    expect("{");
    while (!accept("}")) {
      items.push(item());
      expect(";");
    }
    return items;
  }

  const definitions = new Map<string, Definition>();
  const additions: Array<[to: string, members: () => Member[]]> = [];
  const membersOf = (name: string) => (definitions.get(name) as { members: Member[] } | undefined)?.members;
  while (at < tokens.length) {
    attributes();
    const isPartial = accept("partial");
    const keyword = next();
    if (keyword === "interface" || keyword === "namespace") {
      const kind = accept("mixin") ? "mixin" : keyword;
      const name = next();
      const base = accept(":") ? next() : undefined;
      const members = block(member);
      if (isPartial) additions.push([name, () => members]);
      else definitions.set(name, { kind, name, base, members });
    } else if (keyword === "dictionary") {
      const name = next();
      const base = accept(":") ? next() : undefined;
      const members = block(() => {
        const outer = attributes();
        const optional = !accept("required");
        return { type: type(outer), name: next(), optional, ...defaultValue() };
      });
      definitions.set(name, { kind: "dictionary", name, base, members });
    } else if (keyword === "enum") {
      const name = next();
      const values: string[] = [];
      expect("{");
      while (!accept("}")) {
        values.push(next().slice(1, -1));
        accept(",");
      }
      definitions.set(name, { kind: "enum", name, values });
    } else if (keyword === "typedef") {
      const aliased = type();
      const name = next();
      definitions.set(name, { kind: "typedef", name, type: aliased });
    } else {
      expect("includes");
      const mixin = next();
      additions.push([keyword, () => membersOf(mixin)!]);
    }
    expect(";");
  }
  // `Navigator` is another specification's.
  for (const [to, members] of additions) membersOf(to)?.push(...members());
  return definitions;
}
