// The functions of a decorator's `context.access` are written inside helpers that `bun run` keeps in bun:wrap: their frames name that module, as the helpers' own frames do.
const frames = (error: Error) => error.stack!.split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/\(.*[\/\\]/, "(").replace(/^.*[\/\\]/, "").replace(/:\d+:\d+/, "").replace(/^\S+ \(bun:wrap\)/, "* (bun:wrap)")).join(" < ");
const show = (what: string) => console.log(what + ": " + frames(new Error()));
const fails = (what: string, f: () => unknown) => { try { f(); console.log(what + ": nothing thrown"); } catch (error) { console.log(what + ": " + (error as Error).message + ": " + frames(error as Error)); } };
let access: any, context: any;
const keeps = (value: any, c: any) => { access = c.access; context = c; };
class Getter { @keeps get p() { show("access.get of a getter"); return 1; } }
access.get(new Getter());
class Setter { @keeps set p(v: number) { show("access.set of a setter"); } }
access.set(new Setter(), 1);
class PrivateGetter { @keeps get #p() { show("access.get of a private getter"); return 1; } }
access.get(new PrivateGetter());
class Accessor { @keeps accessor a = 1; }
fails("access.get of an accessor on another object", () => access.get({}));
