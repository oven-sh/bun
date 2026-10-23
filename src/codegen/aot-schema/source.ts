export interface Location {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

export function compareLocations(
  files: readonly { readonly path: string }[],
): (left: Location, right: Location) => number {
  const positions = new Map(files.map((file, index) => [file.path, index]));
  const positionOf = (location: Location) => positions.get(location.path) ?? files.length;
  return (left, right) => positionOf(left) - positionOf(right) || left.line - right.line || left.column - right.column;
}

export class SchemaError extends Error {
  readonly location: Location;
  readonly problem: string;

  constructor(location: Location, problem: string) {
    super(`${location.path}:${location.line}:${location.column}: ${problem}`);
    this.name = "SchemaError";
    this.location = location;
    this.problem = problem;
  }
}

export class SchemaErrors extends Error {
  readonly errors: readonly SchemaError[];

  constructor(errors: readonly SchemaError[]) {
    super(errors.map(error => error.message).join("\n"));
    this.name = "SchemaErrors";
    this.errors = errors;
  }
}

export class ErrorList {
  readonly #errors: SchemaError[] = [];
  readonly #messages = new Set<string>();

  // A parameter group, a named set and a family default are resolved once for each entry that uses them.
  add(location: Location, problem: string): void {
    const error = new SchemaError(location, problem);
    if (this.#messages.has(error.message)) return;
    this.#messages.add(error.message);
    this.#errors.push(error);
  }

  get isEmpty(): boolean {
    return this.#errors.length === 0;
  }

  throwIfAny(files: readonly { readonly path: string }[]): void {
    if (this.#errors.length === 0) return;
    const compare = compareLocations(files);
    throw new SchemaErrors([...this.#errors].sort((left, right) => compare(left.location, right.location)));
  }
}

export type ReadFile = (path: string) => string | null;
