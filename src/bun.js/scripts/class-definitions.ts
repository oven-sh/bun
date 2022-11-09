export type Field =
  | { getter: string; cache?: true | string }
  | { setter: string }
  | { accessor: { getter: string; setter: string }; cache?: true | string }
  | {
      fn: string;
      length?: number;
      DOMJIT?: {
        returns: string;
        args?: [string, string] | [string, string, string] | [string];
      };
    }
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
}

export function define(
  {
    klass = {},
    proto = {},
    values = [],
    estimatedSize = false,
    call = false,
    construct = false,
    ...rest
  } = {} as ClassDefinition,
): ClassDefinition {
  return {
    ...rest,
    call,
    construct,
    estimatedSize,
    values,
    klass: Object.fromEntries(
      Object.entries(klass).sort(([a], [b]) => a.localeCompare(b)),
    ),
    proto: Object.fromEntries(
      Object.entries(proto).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
