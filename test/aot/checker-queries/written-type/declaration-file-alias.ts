// A type that only a `.d.ts` declares is never tested: where the type cannot show who declared it, the written type is `unknown`. What the checked file writes around it stays.
/// <reference path="./declaration-file-alias.d.ts" />
interface Mine { port: number }
type Own = number;
type Local = Port;
type Field<T extends { port: unknown }> = T["port"];
let a: Port;
let b: Local;
let c: Level;
let d: Port | undefined;
let e: Port[];
let f: Map<string, Port>;
let g: Mode;
let h: Mode | undefined;
let i: Mode[];
let j: Pair;
let k: Host["port"];
let l: keyof Host;
let m: typeof hostPort;
let n: Field<Host>;
let o: Options[];
let p: Host;
let q: Own;
let r: Field<Mine>;
function s(mode?: Mode) { let held: typeof mode; }
let t: Ports;
let u: ByName;
let v: Later<Mine>;
let w: Several<Mine>;
let x: Ports[];
export {};
