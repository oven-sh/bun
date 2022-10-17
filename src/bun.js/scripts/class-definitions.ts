export type Field =
  | { getter: string; cache?: true | string }
  | { setter: string }
  | { accessor: { getter: string; setter: string }; cache?: true | string }
  | {
      fn: string;
      length?: number;
      DOMJIT?: {
        return: string;
        args?: [string, string] | [string, string, string] | [string];
      };
    };

export interface ClassDefinition {
  name: string;
  construct?: boolean;
  finalize?: boolean;
  klass: Record<string, Field>;
  proto: Record<string, Field>;
  values?: string[];
  JSType?: string;
  noConstructor?: boolean;
  estimatedSize?: boolean;
  isEventEmitter?: boolean;
}

export function define(
  {
    klass = {},
    proto = {},
    isEventEmitter = false,
    estimatedSize = false,
    ...rest
  } = {} as ClassDefinition
): ClassDefinition {
  return {
    ...rest,
    isEventEmitter,
    estimatedSize,
    klass: Object.fromEntries(
      Object.entries(klass).sort(([a], [b]) => a.localeCompare(b))
    ),
    proto: Object.fromEntries(
      Object.entries(proto).sort(([a], [b]) => a.localeCompare(b))
    ),
  };
}
