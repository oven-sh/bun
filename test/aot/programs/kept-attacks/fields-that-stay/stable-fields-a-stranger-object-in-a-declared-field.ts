// An object that was not born under the declared type of a property, such as one from JSON.parse, can be stored there as in plain Bun: only its kind counts.
// Columns: fields wide kinds: as plain Bun. Under types each store throws: a-stranger-object-in-a-declared-field.types.txt.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
interface Config { host: string; port: number }
class Server { config: Config = { host: "born", port: 1 }; }
const strangers: [string, () => unknown][] = [
  ["an object from JSON.parse with the names", () => JSON.parse('{"host":"parsed","port":2}')],
  ["an object from JSON.parse with other names", () => JSON.parse('{"other":1}')],
  ["an object from Object.create", () => Object.assign(Object.create(null), { host: "created" })],
  ["an array", () => ["listed"]],
  ["a Map", () => new Map([["host", "mapped"]])],
];
function hostOf(server: Server) { return server.config.host; }
for (const [what, make] of strangers) {
  const server = new Server();
  attempt(what, () => { (server as any).config = make(); return Object.prototype.toString.call((server as any).config); });
  attempt("  read by typed code", () => String(hostOf(server)));
}
