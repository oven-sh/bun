/**
 * All build system errors go through this. Includes context for helpful messages.
 */
export class BuildError extends Error {
  readonly hint: string | undefined;
  readonly file: string | undefined;

  constructor(
    message: string,
    context?: {
      hint?: string;
      file?: string;
      cause?: unknown;
    },
  ) {
    super(message, context?.cause !== undefined ? { cause: context.cause } : undefined);
    this.name = "BuildError";
    this.hint = context?.hint;
    this.file = context?.file;
  }

  /**
   * Format for display to the user.
   */
  format(): string {
    let out = `error: ${this.message}\n`;
    if (this.file !== undefined) {
      out += `  at: ${this.file}\n`;
    }
    if (this.hint !== undefined) {
      out += `  hint: ${this.hint}\n`;
    }
    if (this.cause !== undefined) {
      out += `  cause: ${describeError(this.cause)}\n`;
    }
    return out;
  }
}

/** The whole cause chain on one line: fetch() rejects with a bare "fetch failed" and keeps the socket/DNS/TLS error in `.cause` (or `.cause.errors[]`). */
export function describeError(err: unknown, depth = 0): string {
  if (!(err instanceof Error)) return String(err);
  let out = err.message;
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== undefined && !out.includes(code)) out = `${code}: ${out}`;
  if (depth >= 5) return out;
  if (err instanceof AggregateError && err.errors.length > 0) {
    out += ` [${err.errors.map(e => describeError(e, depth + 1)).join("; ")}]`;
  }
  if (err.cause !== undefined) out += ` <- ${describeError(err.cause, depth + 1)}`;
  return out;
}

/**
 * Assert a condition, throwing BuildError if false.
 */
export function assert(
  condition: unknown,
  message: string,
  context?: { hint?: string; file?: string },
): asserts condition {
  if (!condition) {
    throw new BuildError(message, context);
  }
}
