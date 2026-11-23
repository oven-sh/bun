// What a program stores into a proxy, or a trap of it stores into its target, is what every file reads off the enum below it.
import { Asked, Assigned, Constructed, Defined, Deleted, Kept, Made, Nested, Renamed, Revocable, Stored, Trapped } from "./kinds";
import { make, named, set } from "./helpers";

const reads = () => [Stored.A, Trapped.B, Defined.C, Deleted.D, Revocable.E, Made.F, Renamed.G, Nested.H, Assigned.I, Asked.J, Constructed.L, Kept.K].join();
console.log(reads());

const stored: any = new Proxy(Stored, {});
stored.A = 9;
const trapped: any = new Proxy(Trapped, { set });
trapped.B = 9;
const defined: any = new Proxy(Defined, {});
Object.defineProperty(defined, "C", { value: 9, writable: true, configurable: true, enumerable: true });
const deleted: any = new Proxy(Deleted, {});
delete deleted.D;
const revocable = Proxy.revocable<any>(Revocable, {});
const { proxy } = revocable;
proxy[named("E")] = 9;
revocable.revoke();
make(Made)[named("F")] = 9;
const Other = Proxy;
const renamed: any = new Other(Renamed, {});
renamed["G"] = 9;
const nested: any = new Proxy(new Proxy(Nested, {}), {});
nested.H++;
Object.assign(new Proxy(Assigned, {}), JSON.parse('{"I":9}'));
const asked: any = new Proxy(Asked, { get(target: any, key: string) { target[key] = 9; return target[key]; } });
console.log(asked.J);
Object.defineProperty(Reflect.construct(Proxy, [Constructed, {}]), "L", { value: 9 });

console.log(reads());
for (let turn = 0; turn < 60; turn++) {
  stored.A2 = turn;
  if (Stored.A2 !== turn || Kept.K2 !== 2) console.log("read in place", turn, Stored.A2);
}
console.log(Stored.A2, Stored[1], Kept[1]);
