export class Ledger {
  names: string[] = [];
  sums = new Map<string, number>();
  seen = new Set<string>();
  add(line: string): void {
    const parts = line.split(",");
    const name = parts[0].trim();
    this.names.push(name);
    this.seen.add(name);
    this.sums.set(name, (this.sums.get(name) ?? 0) + Number(parts[1]));
  }
  says(): string {
    return this.names.join("+") + " " + this.sums.has("b") + " " + this.seen.has("a") + " " + this.sums.get("a") + " " + this.names.includes("b") + " " + this.names.indexOf("b") + " " + this.seen.size;
  }
}
export function emptied(caches: Set<any>): number {
  let left = 0;
  for (const cache of caches) {
    cache.clear();
    left += cache.size;
  }
  return left;
}
export function asked(thing: any, key: any): unknown {
  return thing.has(key);
}
export function got(thing: any, key: () => any): unknown {
  return thing.get(key());
}
export function cut(text: any): string {
  return text.trimStart() + "|" + text.trimLeft() + "|" + text.slice(1) + "|" + text.startsWith(" a") + "|" + text.indexOf("b");
}
export function matched(pattern: any, text: string): unknown {
  return pattern.test(text) + " " + (pattern.exec(text) ?? ["none"])[0];
}
export function popped(list: any): string {
  list.push(7, 8);
  return list.pop() + " " + list.shift() + " " + list.slice(1).length + " " + list.length;
}
