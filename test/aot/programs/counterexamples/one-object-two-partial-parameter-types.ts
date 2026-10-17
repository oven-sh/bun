// Untyped code hands one object to methods whose parameter types each name some of its properties.
declare const console: { log(...values: unknown[]): void };
class Widget {
  static derive(props: { step: number }, state: { from: number }): { from: number } | null { return props.step !== state.from ? { from: props.step } : null }
  should(_p: unknown, next: { n: number }): boolean { return next.n > 0 }
  did(prev: { n: number; from: number }): string { return prev.n + ":" + prev.from }
}
function drive(ctor: any, instance: any, state: any): string {
  const part = ctor.derive({ step: 2 }, state);
  const next = part === null ? state : Object.assign({}, state, part);
  return String(instance.should(null, next)) + " " + instance.did(next) + " " + String(instance.should(null, state)) + " " + instance.did(state) + " " + JSON.stringify(state);
}
try { console.log(drive(Widget, new Widget(), { from: 1, n: 3, more: "m" })); } catch (e) { console.log("THROWN: " + (e as Error).message.split("\n").slice(0, 2).join(" | ").slice(0, 200)); }
try { console.log(drive(Widget, new Widget(), JSON.parse('{"from":2,"n":0,"more":"j"}'))); } catch (e) { console.log("THROWN: " + (e as Error).message.split("\n").slice(0, 2).join(" | ").slice(0, 200)); }
