function mark(target: any, key: string) { (target.marked ??= []).push(key); }
export class Marked { @mark two(): number { return 2; } }
export const marked: string = (Marked.prototype as any).marked.join();
