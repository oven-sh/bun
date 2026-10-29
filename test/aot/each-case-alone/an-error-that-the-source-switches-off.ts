// The checker reports an error here and the source tells it to go on: what the line declares is not true.
declare const console: { log(...values: unknown[]): void };
function t(name: string, f: () => unknown) { let r: string; try { r = String(f()); } catch (e) { r = "threw " + (e instanceof Error ? e.name : typeof e); } console.log(name, r); }
// @ts-expect-error
const ignoredError: number = "text";
t("an error that the source switches off", () => ignoredError * 2);
