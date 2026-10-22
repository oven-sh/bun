interface Thing {
  n: number;
  tag: string;
}
export const keptByHelpers: Thing[] = [];
export let helper = (t: Thing): number => t.n;
export function replaceHelper(): void {
  helper = t => {
    keptByHelpers.push(t);
    return -t.n;
  };
}
let pool: Thing | null = null;
export function makeThing(n: number): Thing {
  return pool ?? { n, tag: "made " + n };
}
export function poolThings(): void {
  pool = { n: 0, tag: "pooled" };
}
export let counter = 0;
export function bump(): number {
  return ++counter;
}
export default function (t: Thing): number {
  return helper(t) * 2;
}
