declare const console: { log(...values: unknown[]): void };
class Left extends Error {}
export function fail(msg?: string, cause = "failure"): never { if (msg) console.log("fail", msg, cause); if (cause) throw new Left("fail"); return undefined as never }
export function exitWith(code: number): never { console.log("exit", code); if (code >= 0) throw new Left("exit " + code); return undefined as never }
