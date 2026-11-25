// Flags: --define=OF_DEFAULT=config.level --define=HOLDER=config.holder --define=OF_NAMESPACE=ns.count --define=OF_NAMED=count --define=OF_CJS=cjs.level --define=CJS_HOLDER=cjs.holder --define=OF_CONST=local.level --define=OF_ENUM=Level.High --define=OF_TS_NAMESPACE=inner --define=process.env.OF_PATH=local.level --define=LIST=local.list --define=FIXED=2
// Reference: bun build --compile
// The first name of a path is bound where the path is written, at the top of the file too.
// @ts-nocheck
import config from "./esm.mjs";
import * as ns from "./esm.mjs";
import { bump, count } from "./esm.mjs";
import cjs from "./cjs.cjs";
const local = { level: 4, list: [] };
enum Level { Low, High }
namespace Space { export let inner = 5; console.log(OF_TS_NAMESPACE, OF_TS_NAMESPACE++, Space.inner); }
console.log(OF_DEFAULT, HOLDER(), OF_NAMESPACE, OF_NAMED, OF_CJS, CJS_HOLDER(), OF_CONST, OF_ENUM, process.env.OF_PATH);
bump();
OF_CONST = 6;
OF_DEFAULT += 5;
console.log(OF_NAMESPACE, OF_NAMED, OF_CONST, HOLDER(), typeof OF_CONST, typeof process.env.OF_PATH);
OF_CONST = 0;
console.log(OF_CONST ? "truthy" : "falsy", LIST.push(1), LIST.join());
console.log(((local) => OF_CONST)({ level: 8 }));
globalThis.FIXED = 0;
FIXED = 9;
console.log(FIXED, globalThis.FIXED);
