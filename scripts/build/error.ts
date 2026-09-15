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

/**
 * One line naming an error and everything it wraps, outermost first:
 * `while fetching https://codeload.github.com/...: ECONNRESET: socket hang up`.
 * An error's own message is often content-free: node's socket errors say
 * "socket hang up" and keep the reason in `code`, a connect that failed on
 * every resolved address is an AggregateError whose own message is empty,
 * and wrappers put the interesting part in `cause`.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [];
  const seen = new Set<Error>();
  let e: unknown = err;
  while (e instanceof Error && !seen.has(e)) {
    seen.add(e);
    let part = e.message || e.name;
    if (e instanceof AggregateError && e.errors.length > 0) {
      const inner = e.errors.map(describeError).join("; ");
      part = e.message ? `${e.message} (${inner})` : inner;
    }
    // `getaddrinfo ENOTFOUND host` already names its code; "socket hang up" does not.
    const { code } = e as NodeJS.ErrnoException;
    if (typeof code === "string" && code !== "" && !part.includes(code)) part = `${code}: ${part}`;
    parts.push(part);
    e = e.cause;
  }
  // A non-Error cause (`{ cause: "ECONNRESET" }`) still carries the reason.
  if (e !== undefined && e !== null && !(e instanceof Error)) parts.push(String(e));
  return parts.join(": ");
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
