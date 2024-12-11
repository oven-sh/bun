const { isNativeError } = require("node:util/types");

/**
 * @fixme errors thrown in a different VM context are neither `isNativeError`
 * nor `instanceof Error`.
 */
export const isError = (err: unknown): err is Error => isNativeError(err) || err instanceof Error || (typeof err === 'object' && err !== null && 'name' in err && 'message' in err && 'stack' in err);
