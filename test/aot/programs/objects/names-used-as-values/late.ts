export const lateTag = Symbol("tag");

export function lateLiteral(start: number) {
  let held = start;
  return {
    get [lateTag]() { return "late " + held; },
    get level() { return held + 100; },
    set level(v: number) { held = v; },
  };
}

type LateSignal = typeof lateTag | typeof Symbol.iterator | string;
export function reactLate(signal: LateSignal): string {
  if (signal === lateTag) return "late tag";
  if (signal === Symbol.iterator) return "iterator";
  return "other " + String(signal);
}
