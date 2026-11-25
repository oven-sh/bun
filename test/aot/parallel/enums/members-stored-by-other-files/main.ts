// The values are the ones that the objects hold: a file that stores into an enum of another file changes what every other file reads.
import {
  Aliased, Assigned, Bracketed, Defined, Deleted, Destructured, Extended, Held, Keyed, Looped, Merged, Passed, PassedOn, Stepped,
} from "./kinds";
import { OtherName, kinds as exported } from "./barrel";
import * as kinds from "./kinds";
import { own } from "./kinds";
import { count, store, storeUnderKey } from "./helpers";
import { reads } from "./reads";
console.log(reads(), own());
(Assigned as any).One = "far";
(Bracketed as any)["One"] = "far";
const key: string = "One";
(Keyed as any)[key] = "far";
(Stepped as any).One++;
delete (Deleted as any).One;
[(Destructured as any).One] = ["far"];
Object.assign(Merged, { One: "far", Later: 3 });
Object.defineProperty(Defined, "One", { get: () => "far" });
const held: any = Aliased;
held.One = "far";
store(Passed, "far");
storeUnderKey(PassedOn, "One", "far");
for (const name of Object.keys({ One: 0 })) (Looped as any)[name] = "far";
(OtherName as any).One = "far";
(kinds.OffNamespace as any).One = "far";
(exported.OffExportedNamespace as any).One = "far";
(Extended as any).Later = 3;
(Extended as any)[3] = "Later";
console.log(count(Held), reads(), own());
console.log(Assigned.One, Keyed.One, Merged.One, Passed.One, OtherName.One, (Extended as any).Later, JSON.stringify([Assigned, Merged, Extended]));
