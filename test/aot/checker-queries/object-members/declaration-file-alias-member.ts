// A member that the program annotates with a type alias of a `.d.ts` is written as `unknown`: nothing is tested where it is stored or read. A member of a mapped type whose template names such an alias is unwritten.
/// <reference path="./declaration-file-alias-member.d.ts" />
interface Settings { port: Port; mode: Mode | null; retries: number }
interface Ports { [name: string]: Port }
class Server { port: Port = 0; }
let a: Settings;
let b: Ports;
let c: Server;
let d: { [K in "first" | "second"]: Port };
export {};
