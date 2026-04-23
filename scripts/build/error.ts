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
      const cause = this.cause instanceof Error ? this.cause.message : String(this.cause);
      out += `  cause: ${cause}\n`;
    }
    return out;
  }
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

/**
 * Assert a value is defined (not undefined or null).
 */
export function assertDefined<T>(
  value: T | undefined | null,
  message: string,
  context?: { hint?: string; file?: string },
): asserts value is T {
  if (value === undefined || value === null) {
    throw new BuildError(message, context);
  }
}
