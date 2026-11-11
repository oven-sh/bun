function made(o: unknown): { (a: number): number; (a: string): string } { return o as any; }
function one(o: unknown): { (a: number): number } { return o as any; }
function built(o: unknown): { new (a: number): object; (a: string): string } { return o as any; }
function keyed(o: unknown): { [key: string]: number; (a: string): string; [index: number]: number } { return o as any; }
function taken(o: { (a: number): number; (a: string): string }) { return o; }
function held(o: unknown) { let kept: { (a: number): number; (a: string): string } = o as any; return kept; }
function cast(o: unknown) { return (o as { (a: number): number; (a: string): string })(1); }
const arrow = (o: unknown): { (a: number): number; (a: string): string } => o as any;
class Holder {
  field: { (a: number): number; (a: string): string } = (a: any) => a;
  [key: string]: unknown;
  method(o: unknown): { (a: number): number; (a: string): string } { return o as any; }
}
interface Outside { (a: number): number; (a: string): string }
for (const asked of [made, one, built, keyed, taken, held, cast, arrow, Holder]) {
  try {
    console.log(asked.name, typeof new Function("return (" + String(asked) + "\n)")());
  } catch (error) {
    console.log(asked.name, (error as Error).name);
  }
}
console.log(String(new Function("return ({ " + String(Holder.prototype.method) + "\n}).method")()(7)));
