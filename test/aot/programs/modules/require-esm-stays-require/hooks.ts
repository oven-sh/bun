let count = 0;
export function called(): number { return count; }
export function note(): void { count++; }
const holder = { method(this: any): string { this.note(); return typeof this.called; } };
export const ofAnObject: (this: any) => string = holder.method;
export let changing: (this: any) => string = function (this: any) { return "first " + Object.keys(this).length; };
export function swap(): void { changing = function (this: any) { return "second " + typeof this.swap; }; }
export const made = ((): ((this: any) => string) => function (this: any) { return "made " + typeof this.made; })();
export const arrow = (): string => "arrow";
export function looksAtNothing(): string { return "nothing"; }
