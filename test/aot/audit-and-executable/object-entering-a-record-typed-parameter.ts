// An object that code which is not compiled hands to a function whose parameter is a record type.
const say = (label: string, f: () => unknown): void => { let r: string; try { r = String(f()); } catch (e) { r = "throws " + (e as Error).name + ": " + (e as Error).message.split("\n")[0].replace(/ \(bun compile[^)]*\)/, "").replace(/ \(declared at [^)]*\)/g, ""); } console.log(label + " ==> " + r); };
interface Stream { id: number; event: string; name?: string }
type Handler = (process: Stream) => string;
const call = new Function("handler", "value", "return handler(value)") as (handler: Handler, value: unknown) => string;
const handler: Handler = process => process.event;
say("every member fits", () => call(handler, { id: 1, event: "e" }));
say("a member it does not read has another type", () => call(handler, { id: "1", event: "e" }));
say("a member it does not read is missing", () => call(handler, { event: "e" }));
say("a Proxy of a fitting object", () => call(handler, new Proxy({ id: 1, event: "e" }, {})));
say("a string", () => call(handler, "text"));
