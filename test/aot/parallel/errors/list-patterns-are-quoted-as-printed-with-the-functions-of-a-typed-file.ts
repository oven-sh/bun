import fs from "node:fs";
import { join as joined } from "node:path";
enum Color { Red, Green }
type Pair = [number, string];
interface Shape { a: number }
function tell(label: string, run: () => unknown) {
  try { run(); console.log(label + ": no error"); } catch (error: any) { console.log(label + ": " + JSON.stringify(error.message)); }
}
const lists: Record<string, (v: any) => unknown> = {
  types(v: any) { const [ f = function( x: number, y?: string ): string { const z: number = x as number; return String(z!) + (y satisfies string | undefined) } ] = v; return f; },
  generic(v: any) { const [ f = function<T extends Shape>( x: T ): T { return x } ] = v; return f; },
  genericArrow(v: any) { const [ f = <T,>( x: T ): T => { return x } ] = v; return f; },
  typedArrow(v: any) { const [ f = ( x: number ): number => { const y: Pair = [x, 'a']; return y[0] } ] = v; return f; },
  typedList(v: any) { const [ f = function(): void { } ]: [(() => void)?] = v; return f; },
  members(v: any) { const [ K = class<T> implements Shape { a: number = 1; private b?: T; readonly c = 2; declare d: string; constructor( public e: number, private f = 1 ){ } m<U>( x: U ): U { return x } } ] = v; return K; },
  abstractOne(v: any) { const [ K = class { static s: number; m( this: Shape ): number { return this.a } } ] = v; return K; },
  enums(v: any) { const [ f = function(){ return Color.Green + Color.Red } ] = v; return f; },
  imports(v: any) { const [ f = function(){ return [ fs.existsSync,joined,import.meta.url,import.meta.dir ] } ] = v; return f; },
  requires(v: any) { const [ f = function(){ return require( 'node:os' ) } ] = v; return f; },
  typesInFront(v: any) { const a: Array<{ x: number }> = []; const [ f = function( x: number ){ return x } ] = v; return [a, f]; },
  innerTypes(v: any) { const [ f = function(){ type T = number; interface I { a: T } const x: I = { a: 1 }; return x } ] = v; return f; },
  innerEnum(v: any) { const [ f = function(){ enum E { A, B = 5 } return E.B } ] = v; return f; },
};
function inner(v: any, w: any) {
  const [ f = function( u: any ): number { const [ x,y ]: Pair = u; return x } ] = v;
  return f(w);
}
for (const bad of [null, undefined]) {
  for (const name of Object.keys(lists)) tell(name + " " + bad, () => lists[name](bad));
  tell("inner " + bad, () => inner(bad, bad));
  tell("inner, inside " + bad, () => inner([], bad));
}
try { const [ f = function( x: number ): number { return x } ]: any = (globalThis as any).nothing; } catch (error: any) { console.log("at the top: " + JSON.stringify(error.message)); }
