// A parameter without its own annotation, contextually typed from a declaration file: it receives whatever the embedder passes, whatever the declaration says. Also where the literal is first stored in a variable of the embedder's type.
import type { Handler, Listener } from "./host";
const said: string[] = [];
const kindOf = (v: unknown) => (v === null ? "null" : v instanceof ArrayBuffer ? "ArrayBuffer" : v instanceof Uint8Array ? "Uint8Array" : typeof v);
const kept = { open(socket) { said.push("open " + kindOf(socket)); }, data(socket, buffer) { said.push("data " + kindOf(buffer)); }, close(socket, code) { said.push("close " + kindOf(code)); return "closed"; } } as Handler<any>;
const annotated: Handler = { data(socket, buffer) { said.push("data under an annotation " + kindOf(buffer)); } };
const satisfied = { data(socket, buffer) { said.push("data under satisfies " + kindOf(buffer)); } } satisfies Handler;
const listener: Listener = event => { said.push("listener " + kindOf(event) + " " + kindOf((event as any)?.count)); };
const written = { data(socket: unknown, buffer: Uint8Array) { said.push("data with a written parameter " + kindOf(buffer)); } };
const host: any = { run(handler: any, ...given: unknown[]) { for (const name of ["open", "data", "close"]) handler[name]?.({ data: 1 }, ...given); } };
for (const given of [new Uint8Array(1), new ArrayBuffer(1), "text", 5, null, undefined]) {
  for (const handler of [kept, annotated, satisfied]) { try { host.run(handler, given); } catch (e) { said.push("THROWS " + (e as Error).message.split(" (bun")[0]); } }
  try { (listener as any)(given); } catch (e) { said.push("THROWS " + (e as Error).message.split(" (bun")[0]); }
}
host.run(written, new Uint8Array(2));
console.log(said.join("\n"));
