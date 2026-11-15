import { call } from "./importer.ts";
export namespace Api { export function read(): string | undefined { return KEY === undefined ? "early" : ({ late: KEY + "!" } as any)[KEY]; } }
call("first");
var KEY = "late";
console.log(Api.read());
