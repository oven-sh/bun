enum Color { Red, Green }
enum Word { Yes = "yes" }
interface Shape { a: number }
function tell(label: string, run: () => unknown) {
  try { run(); console.log(label + ": no error"); } catch (error: any) { console.log(label + ": " + JSON.stringify(error.message)); }
}
const o: any = { none: null, deep: {}, same(value: unknown) { return value; } };

tell("types in a function", () => o.nothing(function( x: number, y?: string ): string { const z: number = x as number; return String(z!) + y }));
tell("types in an arrow", () => o.nothing(( x: number ): number=>{ return x }));
tell("generic function", () => o.nothing(function<T extends Shape>( x: T ): T { return x }));
tell("generic arrow", () => o.nothing(<T,>( x: T ): T => x));
tell("class with types", () => o.nothing(class<T> implements Shape { a: number = 1; private b?: T; constructor( public c: string ){ } m( x: T ): T { return x } }));
tell("method with types", () => o.nothing({ m( x: number ): number { return x } }));
tell("function with a type behind it", () => o.nothing(function(){ return 1 } as () => number, (( x: number )=>x) satisfies unknown));
tell("member of an enum", () => o.nothing(Color.Green, Word.Yes));
tell("member of an enum in a function", () => o.nothing(function(){ return Color.Green }));
tell("member of an enum beside a function", () => o.nothing(Color.Red,function(){ return 1 },Color.Green));
tell("read from a member of an enum", () => (Color.Green as any).a.b);
tell("member of an enum in an operator", () => o.nothing(Color.Green+1));
tell("a comment of the program", () => o.nothing(1 /* one */, 2));
tell("types in the arguments", () => o.nothing(o as Shape, o!, <any>o));
tell("constructed", () => new o.nothing(function( x: number ){ return x }));
tell("read behind a call", () => (o.same(function( x: number ){ return x }) as any).a.b);
try { o.nothing(function( x: number ): number { return x }, Color.Green); } catch (error: any) { console.log("at the top: " + JSON.stringify(error.message)); }
