// A cast to a primitive type is tested whoever gave the value: what the host gives throws a TypeError where it is of another kind. Nothing is converted, and null and undefined pass.
interface Headers { [name: string]: string | string[] | number | undefined; ":status"?: number }
declare const hostHeaders: Headers;
declare function hostGives(): string;
declare function hostCalls(f: (headers: Headers, code: string) => void): void;
declare const hostObject: { text: string; count: number; flag: boolean; maybe?: string };
(globalThis as any).hostHeaders = { ":status": 415, "x-n": 7, "x-s": "s", "x-b": true, "x-null": null };
(globalThis as any).hostGives = () => 415;
(globalThis as any).hostCalls = (f: Function) => f({ ":status": 415, "x-n": 7 }, 9);
(globalThis as any).hostObject = { text: 5, count: "6", flag: "yes", maybe: 0 };
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0]; } console.log(name + ": " + JSON.stringify(r)); };
const kind = (v: unknown) => typeof v + " " + String(v);
const key = ["x-n"][0];
row("an index read as string", () => [kind(hostHeaders["x-n"] as string), kind(hostHeaders[key] as string), kind(hostHeaders[":status"] as unknown as string)]);
row("compared", () => { const status = hostHeaders["x-n"] as string; return [(status as unknown) === 7, status == "7", kind(status)]; });
row("stored to a variable without a type", () => { let status = hostHeaders["x-s"] as string; status = hostHeaders["x-n"] as string; return kind(status); });
row("a member read as another primitive", () => [kind(hostObject.text as string), kind(hostObject.count as number), kind(hostObject.flag as boolean), kind(hostObject.maybe as string)]);
row("a member read as another primitive, through unknown", () => [kind(hostObject.text as unknown as number), kind(hostObject.count as unknown as string)]);
row("a result", () => [kind(hostGives() as string), kind(hostGives() as unknown as number)]);
row("a parameter of a host callback", () => { const seen: string[] = []; hostCalls((headers, code) => { seen.push(kind(headers["x-n"] as string), kind(headers[":status"] as number), kind(code as string)); }); return seen; });
row("null and undefined", () => [kind(hostHeaders["x-null"] as string), kind(hostHeaders["none"] as string)]);
row("as the type says", () => [kind(hostHeaders["x-s"] as string), (hostHeaders["x-s"] as string).length, (hostHeaders["x-s"] as string).toUpperCase()]);
row("used as the type says though it is not", () => [String((hostHeaders["x-n"] as string).length), (hostHeaders["x-n"] as string) + "!"]);
