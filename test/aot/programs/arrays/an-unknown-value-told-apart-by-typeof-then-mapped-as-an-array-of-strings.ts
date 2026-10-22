declare const console: { log(...values: any[]): void };
function safe(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}
function valueSafe(v: unknown): unknown {
  if (typeof v === "string") {
    return safe(v);
  }
  if (typeof v === "boolean") {
    return v;
  }
  if (typeof v === "number") {
    return String(v);
  }
  if (Array.isArray(v) && v.every(x => typeof x === "string")) {
    return v.map(safe);
  }
  return undefined;
}
const parsed: Record<string, unknown> = JSON.parse('{"a": " x\\ny ", "b": true, "c": 3, "d": ["p\\nq", " r "], "e": [1, "s"], "f": null}');
for (const key of Object.keys(parsed)) console.log(key, JSON.stringify(valueSafe(parsed[key])));
