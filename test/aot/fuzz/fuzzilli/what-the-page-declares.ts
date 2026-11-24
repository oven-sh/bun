// What docs/compiler/compatibility.mdx declares of an executable, as the drivers hold a difference against it: one copy for run-alone.ts and run-batch.ts.
// A copy that is wider than the page excuses faults. Each rule here asks for the page's own words and for what those words name, and never excuses a whole program for a word that stands somewhere in its text
// where the two outputs can be compared with that one thing taken out.

export type Said = { stdout: string; stderr: string };
const says = (run: Said, words: string) => run.stderr.includes(words) || run.stdout.includes(words);

/** The objects whose members the page calls read-only, as the refusal spells them. */
const holders =
  /^(?:Object|Function|Array|String|Number|Boolean|BigInt|Symbol|Map|Set|WeakMap|WeakSet|Promise|RegExp|Date|Math|JSON|Reflect|Proxy|Atomics|Buffer|ArrayBuffer|SharedArrayBuffer|DataView|(?:Big)?(?:Int|Uint|Float)\d+(?:Clamped)?Array|Request|Response|Headers|Blob|URL|URLSearchParams|Bun\.CookieMap)(?:\.prototype)?$/;
/** The globals that cannot be replaced. */
const globals =
  /^(?:Object|Array|String|Number|Boolean|BigInt|Symbol|Map|Set|WeakSet|RegExp|Math|JSON|Reflect|Proxy|Atomics|ArrayBuffer|(?:Big)?(?:Int|Uint|Float)\d+(?:Clamped)?Array|globalThis|process)$/;
/** What the language looks up by itself, and the prototypes that do not take it where they do not have it yet. */
const typedArrays = "(?:Big)?(?:Int|Uint|Float)\\d+(?:Clamped)?Array";
const takeNo: Record<string, RegExp> = {
  valueOf: /\.prototype$/,
  toString: /\.prototype$/,
  toLocaleString: /\.prototype$/,
  then: new RegExp(`^(?:Array|Map|Set|WeakMap|RegExp|Date|ArrayBuffer|${typedArrays})\\.prototype$`),
  toJSON: new RegExp(`^(?:Array|WeakMap|Promise|RegExp|ArrayBuffer|${typedArrays})\\.prototype$`),
};

/** Whether the page says of this member, spelled as a refusal spells it, that it cannot be stored to, redefined or deleted. */
export function isReadOnlyByThePage(member: string): boolean {
  if (/^[\w$]+$/.test(member)) return globals.test(member) || holders.test(member);
  const [, holder, name] = /^(.+?)(?:\.([\w$]+)|\[[^\]]*\]+)$/.exec(member) ?? [];
  if (holder === undefined) return false;
  if (/^process(?:\.versions|\.release)?$/.test(holder))
    return /^(?:isBun|versions|release|node|bun|name)$/.test(name ?? "");
  // What `Object.getPrototypeOf(process)` already has. A new name on it is taken.
  if (holder === "%EventEmitter%.prototype")
    return name !== undefined && Object.hasOwn(Object.getPrototypeOf(process), name);
  if (!holders.test(holder)) return false;
  // A symbol or an index.
  if (name === undefined) return true;
  if (
    holder === "Object.prototype" ||
    holder === "Function.prototype" ||
    (Object.hasOwn(takeNo, name) && takeNo[name].test(holder))
  )
    return true;
  // A member that is there is read-only, also where it lies on what the typed arrays share. A new name is taken.
  for (
    let at = holder.split(".").reduce((at: any, step) => at?.[step], globalThis as any);
    at != null && at !== Object.prototype && at !== Function.prototype;
    at = Object.getPrototypeOf(at)
  )
    if (Object.hasOwn(at, name)) return true;
  return false;
}

const refusal =
  /Cannot (?:assign to|delete|change the prototype of) (.+?) because built-in objects are read-only in a compiled executable/g;
/** The executable refused a change of a built-in, and each refusal names what the page lists. A refusal of anything else is a difference like any other. */
export function refusesOnlyWhatThePageLists(ours: Said): boolean {
  const named = [...`${ours.stdout}\n${ours.stderr}`.matchAll(refusal)].map(found => found[1]);
  return named.length > 0 && named.every(isReadOnlyByThePage);
}

/** How deep the stack goes is nobody's promise where `bun <file>` itself comes to its end. An executable that alone comes to it has lost a right program. */
export const comesToTheEndOfTheStack = (plain: Said) => says(plain, "Maximum call stack size exceeded");

/** Code from a string works in an executable. What the page declares of it, the executable says in these words, and only a program that runs such code may hear them. */
export const hearsWhatCodeFromStringsMayHear = (text: string, ours: Said) =>
  /\beval\b|\bFunction\(|node:vm/.test(text) &&
  ["was not compiled into this executable", "Cannot load"].some(words => says(ours, words));

/** `Reflect.setPrototypeOf()` of a built-in object returns false in an executable, and `Object.setPrototypeOf()` throws. A class of the program is no built-in. */
export const setsThePrototypeOfABuiltIn = (text: string) =>
  [...text.matchAll(/\bsetPrototypeOf\(([A-Z][\w$]*(?:\.prototype)?)\s*,/g)].some(
    ([, holder]) =>
      holders.test(holder) && !new RegExp(`\\b(?:class|function|const|let|var) ${holder.split(".")[0]}\\b`).test(text),
  );
