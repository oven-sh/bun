// Exports of start-up modules: each class here has a custom inspect method whose first parameter says string, as the program's call does, and one printer that calls it with a depth, a number. A bit is set for each such printer.
import { format, formatWithOptions, inspect } from "node:util";
import { Console } from "node:console";

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}
const custom = Symbol.for("nodejs.util.inspect.custom");

class ByLog { [custom](depth: string): string { if (typeof depth !== "string") bits |= 1; return "."; } }
class ByInfo { [custom](depth: string): string { if (typeof depth !== "string") bits |= 2; return "."; } }
class ByDebug { [custom](depth: string): string { if (typeof depth !== "string") bits |= 4; return "."; } }
class ByDir { [custom](depth: string): string { if (typeof depth !== "string") bits |= 8; return "."; } }
class ByLogInArray { [custom](depth: string): string { if (typeof depth !== "string") bits |= 16; return "."; } }
class ByLogInObject { [custom](depth: string): string { if (typeof depth !== "string") bits |= 32; return "."; } }
class ByLogInMap { [custom](depth: string): string { if (typeof depth !== "string") bits |= 64; return "."; } }
class ByLogInSet { [custom](depth: string): string { if (typeof depth !== "string") bits |= 128; return "."; } }
class ByLogFormat { [custom](depth: string): string { if (typeof depth !== "string") bits |= 256; return "."; } }
class ByLogSecond { [custom](depth: string): string { if (typeof depth !== "string") bits |= 512; return "."; } }
class ByBunInspect { [custom](depth: string): string { if (typeof depth !== "string") bits |= 1024; return "."; } }
class ByInspect { [custom](depth: string): string { if (typeof depth !== "string") bits |= 2048; return "."; } }
class ByInspectNested { [custom](depth: string): string { if (typeof depth !== "string") bits |= 4096; return "."; } }
class ByFormat { [custom](depth: string): string { if (typeof depth !== "string") bits |= 8192; return "."; } }
class ByFormatBig { [custom](depth: string): string { if (typeof depth !== "string") bits |= 16384; return "."; } }
class ByFormatRest { [custom](depth: string): string { if (typeof depth !== "string") bits |= 32768; return "."; } }
class ByFormatWithOptions { [custom](depth: string): string { if (typeof depth !== "string") bits |= 65536; return "."; } }
class ByConsoleClass { [custom](depth: string): string { if (typeof depth !== "string") bits |= 131072; return "."; } }
class ByGroup { [custom](depth: string): string { if (typeof depth !== "string") bits |= 262144; return "."; } }
class ByTable { [custom](depth: string): string { if (typeof depth !== "string") bits |= 524288; return "."; } }
class ByInspectProxy { [custom](depth: string): string { if (typeof depth !== "string") bits |= 1048576; return "."; } }
class ByInspectHeir { [custom](depth: string): string { if (typeof depth !== "string") bits |= 2097152; return "."; } }
class ByInspectGetter { [custom](depth: string): string { if (typeof depth !== "string") bits |= 4194304; return "."; } }

new ByLog()[custom]("d");
attempt(() => console.log((new ByLog() as any)));
new ByInfo()[custom]("d");
attempt(() => console.info((new ByInfo() as any)));
new ByDebug()[custom]("d");
attempt(() => console.debug((new ByDebug() as any)));
new ByDir()[custom]("d");
attempt(() => console.dir((new ByDir() as any)));
new ByLogInArray()[custom]("d");
attempt(() => console.log([(new ByLogInArray() as any)]));
new ByLogInObject()[custom]("d");
attempt(() => console.log({ a: (new ByLogInObject() as any) }));
new ByLogInMap()[custom]("d");
attempt(() => console.log(new Map([[1, (new ByLogInMap() as any)]])));
new ByLogInSet()[custom]("d");
attempt(() => console.log(new Set([(new ByLogInSet() as any)])));
new ByLogFormat()[custom]("d");
attempt(() => console.log("%o", (new ByLogFormat() as any)));
new ByLogSecond()[custom]("d");
attempt(() => console.log("a", (new ByLogSecond() as any)));
new ByBunInspect()[custom]("d");
attempt(() => Bun.inspect((new ByBunInspect() as any)));
new ByInspect()[custom]("d");
attempt(() => inspect((new ByInspect() as any)));
new ByInspectNested()[custom]("d");
attempt(() => inspect({ a: [(new ByInspectNested() as any)] }));
new ByFormat()[custom]("d");
attempt(() => format("%o", (new ByFormat() as any)));
new ByFormatBig()[custom]("d");
attempt(() => format("%O", (new ByFormatBig() as any)));
new ByFormatRest()[custom]("d");
attempt(() => format("a", (new ByFormatRest() as any)));
new ByFormatWithOptions()[custom]("d");
attempt(() => formatWithOptions({ depth: 0 }, (new ByFormatWithOptions() as any)));
new ByConsoleClass()[custom]("d");
attempt(() => new Console(process.stdout).log((new ByConsoleClass() as any)));
new ByGroup()[custom]("d");
attempt(() => (console.group((new ByGroup() as any)), console.groupEnd()));
new ByTable()[custom]("d");
attempt(() => console.table([{ a: (new ByTable() as any) }]));
new ByInspectProxy()[custom]("d");
attempt(() => inspect(new Proxy((new ByInspectProxy() as any), {})));
new ByInspectHeir()[custom]("d");
attempt(() => inspect(Object.create((new ByInspectHeir() as any))));
new ByInspectGetter()[custom]("d");
attempt(() => inspect({ get a() { return (new ByInspectGetter() as any); } }, { getters: true }));
console.log(bits.toString(2));
