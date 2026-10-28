export function neverLinked(): string { return helperOfNeverLinked(); }
function helperOfNeverLinked(): string { return "never linked"; }
export class NeverLinkedClass {
    neverLinkedField = 1;
    neverLinkedMethod(): string { return "only in the method that is never linked" + this.neverLinkedField; }
}
export const neverLinkedTable = { neverLinkedEntry: 1 };
export const neverLinkedArrow = (): number => neverLinkedTable.neverLinkedEntry;
export function used(): string { return "used"; }
export class UsedClass { usedMethod(): string { return "a method that is used"; } }
export const usedTable = { usedEntry: 2 };
