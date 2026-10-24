import { kinds } from "./shapes";

export interface Tagged {
  tag: string;
  weight: number;
  note?: string;
}

const counts = new Map<string, number>();

export function byTag(one: Tagged): void {
  counts.set(one.tag, (counts.get(one.tag) ?? 0) + one.weight);
}

export function countOf(tag: string): number {
  return counts.get(tag) ?? 0;
}

export function label(one: Tagged | null): string {
  return one === null ? "nothing" : `${one.tag}*${one.weight}${one.note ? "(" + one.note + ")" : ""}`;
}

export function tags(): string[] {
  return kinds.filter(kind => counts.has(kind));
}
