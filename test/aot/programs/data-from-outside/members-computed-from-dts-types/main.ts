// A member whose type a spread or a mapped type computes from a type in a declaration file is not tested: the declaration file may be wrong.
import type { Port, Stringify } from "./host";
const input: any = { a: 5, port: "eighty" };
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0]; } console.log(name + ": " + JSON.stringify(r)); };
const kind = (v: unknown) => typeof v + " " + JSON.stringify(v);
interface Config { a: number }
interface Settings { port: Port }
interface Ports { [name: string]: Port }
row("a spread of a mapped type from the declaration file", () => { const stringified: Stringify<Config> = input; const copy = { ...stringified }; return kind(copy.a); });
row("a spread of an interface", () => { const settings: Settings = input; const copy = { ...settings }; return kind(copy.port); });
row("a library mapped type", () => { const settings: Partial<Settings> = input; return kind(settings.port); });
row("a library mapped type over an index signature", () => { const ports: Readonly<Ports> = input; return kind(ports.port); });
row("a mapped type in the program", () => { const ports: { [K in keyof Settings]: Port } = input; return kind(ports.port); });
row("a member typed by the program alone", () => { const config: Partial<Config> = { a: 1 }; const copy = { ...config }; return kind(copy.a); });
