// Objects returned from async functions that have a `then`: as a field, a method, an accessor, an added property, or on the prototype.
declare const console: any;
const log: string[] = [];
interface Plain { v: number }
interface WithField { v: number; then?: (resolve: (x: number) => void) => void }
class WithMethod { constructor(public v: number) {} then(resolve: (x: number) => void) { log.push("method " + this.v); resolve(this.v + 100); } }
class WithGetter { constructor(public v: number) {} get then() { log.push("getter " + this.v); return undefined; } }
class Derived extends WithMethod {}
class NoThen { constructor(public v: number) {} }
function F(this: Plain, v: number) { this.v = v; }
async function plain(): Promise<any> { const o: Plain = { v: 1 }; return o; }
async function absentField(): Promise<any> { const o: WithField = { v: 2 }; return o as any; }
async function field(): Promise<any> { const o: WithField = { v: 3, then(resolve) { log.push("field 3"); resolve(103); } }; return o as any; }
async function fieldNotCallable(): Promise<any> { const o: any = { v: 4, then: 5 }; return o; }
async function method(): Promise<any> { return new WithMethod(5); }
async function getter(): Promise<any> { return new WithGetter(6); }
async function derived(): Promise<any> { return new Derived(7); }
async function noThen(): Promise<any> { return new NoThen(8); }
async function added(): Promise<any> { const o: Plain = { v: 9 }; (o as any).then = (resolve: (x: number) => void) => { log.push("added 9"); resolve(109); }; return o; }
async function addedOther(): Promise<any> { const o: Plain = { v: 10 }; (o as any).other = 1; return o; }
async function addedThenRemoved(): Promise<any> { const o: Plain = { v: 11 }; (o as any).then = 1; delete (o as any).then; return o; }
async function onPrototypeOfFunction(): Promise<any> { (F as any).prototype.then = function (this: Plain, resolve: (x: number) => void) { log.push("prototype " + this.v); resolve(this.v + 100); }; return new (F as any)(12); }
async function throwing(): Promise<any> { const o: Plain = { v: 13 }; Object.defineProperty(o, "then", { get() { throw new Error("thrown by then"); } }); return o; }
const show = (x: any) => typeof x === "object" && x !== null ? "object " + x.v : String(x);
async function main() {
    for (const f of [plain, absentField, field, fieldNotCallable, method, getter, derived, noThen, added, addedOther, addedThenRemoved, onPrototypeOfFunction, throwing]) {
        for (let twice = 0; twice < 2; twice++) {
            try { log.push(f.name + ": " + show(await f())); } catch (e: any) { log.push(f.name + " threw " + e.message); }
        }
    }
    // The same through `await` of the object itself and through Promise.resolve.
    log.push("await " + show(await (new WithMethod(20) as any)), "await " + show(await ({ v: 21 } as Plain as any)), "resolve " + show(await Promise.resolve(new Derived(22) as any)));
    console.log(log.join("\n"));
}
main();
export {};
