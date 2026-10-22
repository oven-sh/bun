// Methods found through instances: each class here has a toString(radix: number) that the program calls with a number and that one native caller calls without an argument. A bit is set for each caller that passed no number.
import { format } from "node:util";

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class ByJoin { toString(radix: number): string { if (typeof radix !== "number") bits |= 1; return "a"; } }
class ByString { toString(radix: number): string { if (typeof radix !== "number") bits |= 2; return "a"; } }
class ByConcat { toString(radix: number): string { if (typeof radix !== "number") bits |= 4; return "a"; } }
class BySymbol { toString(radix: number): string { if (typeof radix !== "number") bits |= 8; return "a"; } }
class ByRegExp { toString(radix: number): string { if (typeof radix !== "number") bits |= 16; return "a"; } }
class ByParseInt { toString(radix: number): string { if (typeof radix !== "number") bits |= 32; return "a"; } }
class ByKey { toString(radix: number): string { if (typeof radix !== "number") bits |= 64; return "a"; } }
class ByEncode { toString(radix: number): string { if (typeof radix !== "number") bits |= 128; return "a"; } }
class ByError { toString(radix: number): string { if (typeof radix !== "number") bits |= 256; return "a"; } }
class ByReplace { toString(radix: number): string { if (typeof radix !== "number") bits |= 512; return "a"; } }
class ByTemplate { toString(radix: number): string { if (typeof radix !== "number") bits |= 1024; return "a"; } }
class ByPlus { toString(radix: number): string { if (typeof radix !== "number") bits |= 2048; return "a"; } }
class ByIncludes { toString(radix: number): string { if (typeof radix !== "number") bits |= 4096; return "a"; } }
class ByCompare { toString(radix: number): string { if (typeof radix !== "number") bits |= 8192; return "a"; } }
class ByPad { toString(radix: number): string { if (typeof radix !== "number") bits |= 16384; return "a"; } }
class ByHasOwn { toString(radix: number): string { if (typeof radix !== "number") bits |= 32768; return "a"; } }
class ByReflect { toString(radix: number): string { if (typeof radix !== "number") bits |= 65536; return "a"; } }
class ByNumber { toString(radix: number): string { if (typeof radix !== "number") bits |= 131072; return "a"; } }
class ByURL { toString(radix: number): string { if (typeof radix !== "number") bits |= 262144; return "a"; } }
class ByEncoder { toString(radix: number): string { if (typeof radix !== "number") bits |= 524288; return "a"; } }
class ByHeaders { toString(radix: number): string { if (typeof radix !== "number") bits |= 1048576; return "a"; } }
class ByBlob { toString(radix: number): string { if (typeof radix !== "number") bits |= 2097152; return "a"; } }
class ByParams { toString(radix: number): string { if (typeof radix !== "number") bits |= 4194304; return "a"; } }
class ByBtoa { toString(radix: number): string { if (typeof radix !== "number") bits |= 8388608; return "a"; } }
class ByEvent { toString(radix: number): string { if (typeof radix !== "number") bits |= 16777216; return "a"; } }
class ByEnv { toString(radix: number): string { if (typeof radix !== "number") bits |= 33554432; return "a"; } }
class ByFormat { toString(radix: number): string { if (typeof radix !== "number") bits |= 67108864; return "a"; } }
class ByDate { toString(radix: number): string { if (typeof radix !== "number") bits |= 134217728; return "a"; } }
class BySymbolFor { toString(radix: number): string { if (typeof radix !== "number") bits |= 268435456; return "a"; } }
class ByResponse { toString(radix: number): string { if (typeof radix !== "number") bits |= 536870912; return "a"; } }
class ByEscape { toString(radix: number): string { if (typeof radix !== "number") bits |= 1073741824; return "a"; } }

new ByJoin().toString(2);
attempt(() => [(new ByJoin() as any)].join());
new ByString().toString(2);
attempt(() => String((new ByString() as any)));
new ByConcat().toString(2);
attempt(() => "".concat((new ByConcat() as any)));
new BySymbol().toString(2);
attempt(() => Symbol((new BySymbol() as any)));
new ByRegExp().toString(2);
attempt(() => new RegExp((new ByRegExp() as any)));
new ByParseInt().toString(2);
attempt(() => parseInt((new ByParseInt() as any)));
new ByKey().toString(2);
attempt(() => ({} as any)[(new ByKey() as any)]);
new ByEncode().toString(2);
attempt(() => encodeURIComponent((new ByEncode() as any)));
new ByError().toString(2);
attempt(() => new Error((new ByError() as any)));
new ByReplace().toString(2);
attempt(() => "a".replace((new ByReplace() as any), "b"));
new ByTemplate().toString(2);
attempt(() => `(new ByTemplate() as any){(new ByTemplate() as any)}`);
new ByPlus().toString(2);
attempt(() => (new ByPlus() as any) + "");
new ByIncludes().toString(2);
attempt(() => "abc".includes((new ByIncludes() as any)));
new ByCompare().toString(2);
attempt(() => "a".localeCompare((new ByCompare() as any)));
new ByPad().toString(2);
attempt(() => "a".padStart(3, (new ByPad() as any)));
new ByHasOwn().toString(2);
attempt(() => Object.hasOwn({}, (new ByHasOwn() as any)));
new ByReflect().toString(2);
attempt(() => Reflect.get({}, (new ByReflect() as any)));
new ByNumber().toString(2);
attempt(() => Number((new ByNumber() as any)));
new ByURL().toString(2);
attempt(() => new URL((new ByURL() as any), "http://localhost"));
new ByEncoder().toString(2);
attempt(() => new TextEncoder().encode((new ByEncoder() as any)));
new ByHeaders().toString(2);
attempt(() => new Headers([["a", (new ByHeaders() as any)]]));
new ByBlob().toString(2);
attempt(() => new Blob([(new ByBlob() as any)]));
new ByParams().toString(2);
attempt(() => new URLSearchParams({ a: (new ByParams() as any) }));
new ByBtoa().toString(2);
attempt(() => btoa((new ByBtoa() as any)));
new ByEvent().toString(2);
attempt(() => new Event((new ByEvent() as any)));
new ByEnv().toString(2);
attempt(() => (process.env.NATIVE_CALLBACKS = (new ByEnv() as any)));
new ByFormat().toString(2);
attempt(() => format("%s", (new ByFormat() as any)));
new ByDate().toString(2);
attempt(() => new Date((new ByDate() as any)));
new BySymbolFor().toString(2);
attempt(() => Symbol.for((new BySymbolFor() as any)));
new ByResponse().toString(2);
attempt(() => new Response((new ByResponse() as any)));
new ByEscape().toString(2);
attempt(() => Bun.escapeHTML((new ByEscape() as any)));
console.log(bits.toString(2));
