interface PropertyAttribute {
  enumerable?: boolean;
  configurable?: boolean;
}

export type Field =
  | ({ getter: string; cache?: true | string; this?: boolean } & PropertyAttribute)
  | { value: string }
  | ({ setter: string; this?: boolean } & PropertyAttribute)
  | ({
      accessor: { getter: string; setter: string };
      cache?: true | string;
      this?: boolean;
    } & PropertyAttribute)
  | ({
      fn: string;
      length?: number;
      DOMJIT?: {
        returns: string;
        args?: [string, string] | [string, string, string] | [string] | [];
        pure?: boolean;
      };
    } & PropertyAttribute)
  | { internal: true };

export interface ClassDefinition {
  name: string;
  construct?: boolean;
  call?: boolean;
  finalize?: boolean;
  klass: Record<string, Field>;
  proto: Record<string, Field>;
  values?: string[];
  JSType?: string;
  noConstructor?: boolean;
  estimatedSize?: boolean;
  hasPendingActivity?: boolean;
  isEventEmitter?: boolean;

  custom?: Record<string, CustomField>;

  configurable?: boolean;
  enumerable?: boolean;
  structuredClone?: boolean | { transferrable: boolean; tag: number };
}

export interface CustomField {
  header?: string;
  extraHeaderIncludes?: string[];
  impl?: string;
  type?: string;
}

export function define(
  {
    klass = {},
    proto = {},
    values = [],
    estimatedSize = false,
    call = false,
    construct = false,
    structuredClone = false,
    ...rest
  } = {} as ClassDefinition,
): ClassDefinition {
  return {
    ...rest,
    call,
    construct,
    estimatedSize,
    structuredClone,
    values,
    klass: Object.fromEntries(Object.entries(klass).sort(([a], [b]) => a.localeCompare(b))),
    proto: Object.fromEntries(Object.entries(proto).sort(([a], [b]) => a.localeCompare(b))),
  };
}
