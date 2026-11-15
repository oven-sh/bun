// A field written `boolean | undefined` or `boolean | null` lies in one byte: each of the four values is read back as itself, by every use.
interface Options { joins?: boolean; strict?: boolean; quiet?: boolean | null; loud?: boolean }
class Server {
  joins: boolean | undefined;
  strict: boolean;
  quiet: boolean | null;
  loud: boolean;
  constructor(options: Options) {
    this.joins = options.joins;
    this.strict = options.strict === true;
    this.quiet = options.quiet ?? null;
    this.loud = !options.loud;
  }
}
function truth(first: Server | undefined, second: Server): string { const server = first ?? second; return (server.joins ? "joins" : "no") + " " + (server.quiet ? "quiet" : "no"); }
function itself(first: Server | undefined, second: Server): unknown[] { const server = first ?? second; return [server.joins, server.quiet, server.strict, server.loud]; }
function kinds(first: Server | undefined, second: Server): string { const server = first ?? second; return typeof server.joins + " " + typeof server.quiet; }
function compared(first: Server | undefined, second: Server): boolean[] { const server = first ?? second; return [server.joins === undefined, server.joins === false, server.joins == null, server.quiet === null, server.quiet === false, server.quiet == undefined]; }
function otherwise(first: Server | undefined, second: Server): unknown[] { const server = first ?? second; return [server.joins ?? "none", server.quiet ?? "none", server.joins || "falsy", !server.quiet]; }
function counted(first: Server | undefined, second: Server): number { const server = first ?? second; return Number(server.joins) + (server.quiet as unknown as number) * 2; }
function moved(first: Server | undefined, second: Server): void { const server = first ?? second; const kept = server.joins; server.joins = server.quiet ?? undefined; server.quiet = kept ?? null; }
for (const ask of [truth, itself, kinds, compared, otherwise, counted, moved]) (globalThis as any)[ask.name + "ByStrangers"] = ask;
const servers = [new Server({}), new Server({ joins: true, quiet: true }), new Server({ joins: false, quiet: false }), new Server({ joins: true, quiet: null }), new Server({ joins: undefined, quiet: true, strict: true, loud: true })];
for (let round = 0; round < 3; round++) {
  for (const server of servers) {
    console.log(round, truth(undefined, server), JSON.stringify(itself(server, server)), kinds(undefined, server), compared(server, server).join(), JSON.stringify(otherwise(undefined, server)), counted(server, server), JSON.stringify(server));
    moved(undefined, server);
  }
}
