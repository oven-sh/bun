import { readFileSync } from "fs";

export type Operand = "this" | { argument: number } | { argumentsFrom: number };

export interface TypePart {
  part: string;
  pristine?: string[];
  contents?: { slot: string; type: TableType }[];
  class?: string;
  layout?: string;
  builtin?: string;
  operand?: Operand;
  slot?: string;
}

export interface TableType {
  isAnything: boolean;
  hasAnyObject: boolean;
  hasAnyFunction: boolean;
  hasPlainData: boolean;
  primitives: string[];
  integers: { minimum: number; maximum: number } | null;
  stringLiterals: string[];
  freshness: string;
  parts: TypePart[];
}

export interface Parameter {
  operand: Operand;
  mode: "Required" | "Optional" | "Rest";
  accepted: TableType;
  conversion: string;
  uses: string[];
  roles: string[];
  protocols: string[];
  namedMembers: string[];
  calledMembers: string[];
  convertedMembers: string[];
}

export interface Place {
  place: string;
  operand?: Operand;
  slot?: string;
  type?: TableType;
}

export interface Callback {
  callee: Operand;
  times: string;
  constructs: boolean;
  thisValue: Place;
  arguments: Place[];
  spreadArguments: Place;
  resultUse: string;
  resultTo: Place;
}

export interface Overload {
  token: string;
  path: string;
  mode: "Call" | "Construct" | "Get" | "Set";
  isUndeclared: boolean;
  receiver: Parameter | null;
  parameters: Parameter[];
  result: { type: TableType };
  callbacks: Callback[];
  transfers: { from: Place; to: Place }[];
  propertyActions: { action: string; object: Operand; value: Place }[];
  handlerCalls: unknown[];
  throws: boolean;
  implementation: { how: string };
  model: unknown;
}

export interface Entry {
  path: string;
  kind: string;
  origin: "Engine" | "Host";
  holder: string | null;
  name: string;
  instanceClass: string | null;
  overloads: Overload[];
}

export interface Table {
  entries: Entry[];
  classes: {
    token: string;
    parent: string | null;
    slots: { token: string; name: string; contentsSlot: string | null }[];
  }[];
}

export function readTable(path: string): Table {
  return JSON.parse(readFileSync(path, "utf8"));
}

function numberOfUses(table: Table): number {
  let most = 0;
  for (const entry of table.entries) {
    for (const overload of entry.overloads) {
      for (const parameter of [overload.receiver, ...overload.parameters]) {
        if (parameter !== null) most = Math.max(most, parameter.uses.length);
      }
    }
  }
  return most;
}

export function isTrusted(overload: Overload, everyUse: number): boolean {
  const operands = [overload.receiver, ...overload.parameters];
  return (
    !overload.isUndeclared &&
    (!overload.result.type.isAnything ||
      ["HostCall", "Inline", "CachedGetter"].includes(overload.implementation.how)) &&
    !operands.some(parameter => parameter !== null && parameter.uses.length === everyUse)
  );
}

export interface Row {
  path: string;
  origin: string;
  overloads: number;
  entry: Entry;
  trusted: Overload[];
}

export function describedRows(table: Table): Row[] {
  const everyUse = numberOfUses(table);
  const rows: Row[] = [];
  for (const entry of table.entries) {
    const trusted = entry.overloads.filter(overload => isTrusted(overload, everyUse));
    if (trusted.length > 0)
      rows.push({ path: entry.path, origin: entry.origin, overloads: trusted.length, entry, trusted });
  }
  return rows;
}
