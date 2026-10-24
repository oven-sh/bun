// These functions stand for what the program wrote. A stack trace names none of them.
declare var $visibility: "Public" | "Private" | "PrivateRecursive";
declare function $jsonStringify(value: unknown): string;

$visibility = "Private";
export function stringifyProperty(value: unknown, key: string): string {
  const text = $jsonStringify({ [key]: value });
  return text.length === 2 ? "" : text.slice(1, -1);
}

$visibility = "Private";
export function stringifyElement(value: unknown, index: number): string {
  const key = "" + index;
  const text = $jsonStringify({ [key]: value });
  return text.length === 2 ? "null" : text.slice(key.length + 4, -1);
}

$visibility = "Private";
export function stringifyProperties(
  object: Record<string, unknown>,
  keys: string[],
  from: number,
  isFirst: boolean,
): string {
  let text = "";
  for (let i = from; i < keys.length; i++) {
    const key = keys[i];
    const member = stringifyProperty(object[key], key);
    if (member.length === 0) continue;
    text += isFirst ? member : "," + member;
    isFirst = false;
  }
  return text;
}
