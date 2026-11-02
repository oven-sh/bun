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
 * `fetch failed: getaddrinfo EAI_AGAIN github.com`. The outer message alone
 * is often content-free: node's fetch reports every network failure as
 * "fetch failed" and puts the reason (DNS, connect timeout, reset) in
 * `cause`, and a connect that failed on every resolved address is an
 * AggregateError whose own message is empty.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [];
  const seen = new Set<Error>();
  let e: unknown = err;
  while (e instanceof Error && !seen.has(e)) {
    seen.add(e);
    if (e instanceof AggregateError && e.errors.length > 0) {
      const inner = e.errors.map(describeError).join("; ");
      parts.push(e.message ? `${e.message} (${inner})` : inner);
    } else {
      parts.push(e.message || e.name);
    }
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
