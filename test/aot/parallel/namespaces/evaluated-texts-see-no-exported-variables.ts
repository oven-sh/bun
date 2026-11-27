// @ts-nocheck
// The variables that a namespace exports are properties of its object: what a program evaluates does not find them by their names.
function run(f: () => unknown): string { try { return String(f()); } catch (error: any) { return error.name; } }
namespace Names {
  export let variable = 1;
  export const constant = 2;
  let own = 3;
  export function declared() { return 4; }
  export class Declared { static field = 5; }
  export function read(): string {
    return [eval("(function () { return variable; })"), eval("(() => constant)"), eval("(() => own)"), eval("(() => declared())"), eval("(() => Declared.field)"), eval("(() => Names.variable)"), eval("(() => typeof variable)")].map(run).join();
  }
  export function store(): string { return run(eval("(function () { variable = 9; return variable; })")); }
}
console.log(Names.read(), Names.variable);
(globalThis as any).variable = "global";
console.log(Names.read(), Names.variable, Names.store(), Names.variable, (globalThis as any).variable);
