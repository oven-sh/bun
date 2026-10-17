// Variables without an initializer are read by functions and classes that run after the assignment.
declare const console: { log(...values: unknown[]): void };
let port: number;
export let seen: string;
function listen(): string { return "on " + port }
class Server { start(): string { return listen() + " " + seen } }
function late(k: number): number { let d: number; const f = () => d + 1; if (k > 0) d = k; else d = -k; return f() }
function cannot_be_shown(k: number): string { let d: number; const f = () => d; const hold = [f]; d = k; return String(hold[0]()) }
port = 80; seen = "s";
console.log(new Server().start(), late(2), cannot_be_shown(3));
