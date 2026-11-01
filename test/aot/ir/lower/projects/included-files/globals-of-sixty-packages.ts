// RUN: lower

// Globals that packages declare are found through files that only tsconfig.json includes.

// FILE: src/main.ts
console.log(typeof fromPackage0, typeof fromPackage31, typeof fromPackage59);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: tests/setup.ts
import { value as value0 } from "package-0";
import { value as value1 } from "package-1";
import { value as value2 } from "package-2";
import { value as value3 } from "package-3";
import { value as value4 } from "package-4";
import { value as value5 } from "package-5";
import { value as value6 } from "package-6";
import { value as value7 } from "package-7";
import { value as value8 } from "package-8";
import { value as value9 } from "package-9";
import { value as value10 } from "package-10";
import { value as value11 } from "package-11";
import { value as value12 } from "package-12";
import { value as value13 } from "package-13";
import { value as value14 } from "package-14";
import { value as value15 } from "package-15";
import { value as value16 } from "package-16";
import { value as value17 } from "package-17";
import { value as value18 } from "package-18";
import { value as value19 } from "package-19";
import { value as value20 } from "package-20";
import { value as value21 } from "package-21";
import { value as value22 } from "package-22";
import { value as value23 } from "package-23";
import { value as value24 } from "package-24";
import { value as value25 } from "package-25";
import { value as value26 } from "package-26";
import { value as value27 } from "package-27";
import { value as value28 } from "package-28";
import { value as value29 } from "package-29";
import { value as value30 } from "package-30";
import { value as value31 } from "package-31";
import { value as value32 } from "package-32";
import { value as value33 } from "package-33";
import { value as value34 } from "package-34";
import { value as value35 } from "package-35";
import { value as value36 } from "package-36";
import { value as value37 } from "package-37";
import { value as value38 } from "package-38";
import { value as value39 } from "package-39";
import { value as value40 } from "package-40";
import { value as value41 } from "package-41";
import { value as value42 } from "package-42";
import { value as value43 } from "package-43";
import { value as value44 } from "package-44";
import { value as value45 } from "package-45";
import { value as value46 } from "package-46";
import { value as value47 } from "package-47";
import { value as value48 } from "package-48";
import { value as value49 } from "package-49";
import { value as value50 } from "package-50";
import { value as value51 } from "package-51";
import { value as value52 } from "package-52";
import { value as value53 } from "package-53";
import { value as value54 } from "package-54";
import { value as value55 } from "package-55";
import { value as value56 } from "package-56";
import { value as value57 } from "package-57";
import { value as value58 } from "package-58";
import { value as value59 } from "package-59";
export const sum = value0 + value1 + value2 + value3 + value4 + value5 + value6 + value7 + value8 + value9 + value10 + value11 + value12 + value13 + value14 + value15 + value16 + value17 + value18 + value19 + value20 + value21 + value22 + value23 + value24 + value25 + value26 + value27 + value28 + value29 + value30 + value31 + value32 + value33 + value34 + value35 + value36 + value37 + value38 + value39 + value40 + value41 + value42 + value43 + value44 + value45 + value46 + value47 + value48 + value49 + value50 + value51 + value52 + value53 + value54 + value55 + value56 + value57 + value58 + value59;

// FILE: node_modules/package-0/package.json
{"name":"package-0","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-0/index.js
exports.value = 1;

// FILE: node_modules/package-0/index.d.ts
export declare const value: number;
declare global {
  var fromPackage0: number | undefined;
}

// FILE: node_modules/package-1/package.json
{"name":"package-1","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-1/index.js
exports.value = 1;

// FILE: node_modules/package-1/index.d.ts
export declare const value: number;
declare global {
  var fromPackage1: number | undefined;
}

// FILE: node_modules/package-2/package.json
{"name":"package-2","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-2/index.js
exports.value = 1;

// FILE: node_modules/package-2/index.d.ts
export declare const value: number;
declare global {
  var fromPackage2: number | undefined;
}

// FILE: node_modules/package-3/package.json
{"name":"package-3","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-3/index.js
exports.value = 1;

// FILE: node_modules/package-3/index.d.ts
export declare const value: number;
declare global {
  var fromPackage3: number | undefined;
}

// FILE: node_modules/package-4/package.json
{"name":"package-4","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-4/index.js
exports.value = 1;

// FILE: node_modules/package-4/index.d.ts
export declare const value: number;
declare global {
  var fromPackage4: number | undefined;
}

// FILE: node_modules/package-5/package.json
{"name":"package-5","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-5/index.js
exports.value = 1;

// FILE: node_modules/package-5/index.d.ts
export declare const value: number;
declare global {
  var fromPackage5: number | undefined;
}

// FILE: node_modules/package-6/package.json
{"name":"package-6","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-6/index.js
exports.value = 1;

// FILE: node_modules/package-6/index.d.ts
export declare const value: number;
declare global {
  var fromPackage6: number | undefined;
}

// FILE: node_modules/package-7/package.json
{"name":"package-7","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-7/index.js
exports.value = 1;

// FILE: node_modules/package-7/index.d.ts
export declare const value: number;
declare global {
  var fromPackage7: number | undefined;
}

// FILE: node_modules/package-8/package.json
{"name":"package-8","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-8/index.js
exports.value = 1;

// FILE: node_modules/package-8/index.d.ts
export declare const value: number;
declare global {
  var fromPackage8: number | undefined;
}

// FILE: node_modules/package-9/package.json
{"name":"package-9","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-9/index.js
exports.value = 1;

// FILE: node_modules/package-9/index.d.ts
export declare const value: number;
declare global {
  var fromPackage9: number | undefined;
}

// FILE: node_modules/package-10/package.json
{"name":"package-10","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-10/index.js
exports.value = 1;

// FILE: node_modules/package-10/index.d.ts
export declare const value: number;
declare global {
  var fromPackage10: number | undefined;
}

// FILE: node_modules/package-11/package.json
{"name":"package-11","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-11/index.js
exports.value = 1;

// FILE: node_modules/package-11/index.d.ts
export declare const value: number;
declare global {
  var fromPackage11: number | undefined;
}

// FILE: node_modules/package-12/package.json
{"name":"package-12","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-12/index.js
exports.value = 1;

// FILE: node_modules/package-12/index.d.ts
export declare const value: number;
declare global {
  var fromPackage12: number | undefined;
}

// FILE: node_modules/package-13/package.json
{"name":"package-13","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-13/index.js
exports.value = 1;

// FILE: node_modules/package-13/index.d.ts
export declare const value: number;
declare global {
  var fromPackage13: number | undefined;
}

// FILE: node_modules/package-14/package.json
{"name":"package-14","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-14/index.js
exports.value = 1;

// FILE: node_modules/package-14/index.d.ts
export declare const value: number;
declare global {
  var fromPackage14: number | undefined;
}

// FILE: node_modules/package-15/package.json
{"name":"package-15","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-15/index.js
exports.value = 1;

// FILE: node_modules/package-15/index.d.ts
export declare const value: number;
declare global {
  var fromPackage15: number | undefined;
}

// FILE: node_modules/package-16/package.json
{"name":"package-16","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-16/index.js
exports.value = 1;

// FILE: node_modules/package-16/index.d.ts
export declare const value: number;
declare global {
  var fromPackage16: number | undefined;
}

// FILE: node_modules/package-17/package.json
{"name":"package-17","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-17/index.js
exports.value = 1;

// FILE: node_modules/package-17/index.d.ts
export declare const value: number;
declare global {
  var fromPackage17: number | undefined;
}

// FILE: node_modules/package-18/package.json
{"name":"package-18","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-18/index.js
exports.value = 1;

// FILE: node_modules/package-18/index.d.ts
export declare const value: number;
declare global {
  var fromPackage18: number | undefined;
}

// FILE: node_modules/package-19/package.json
{"name":"package-19","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-19/index.js
exports.value = 1;

// FILE: node_modules/package-19/index.d.ts
export declare const value: number;
declare global {
  var fromPackage19: number | undefined;
}

// FILE: node_modules/package-20/package.json
{"name":"package-20","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-20/index.js
exports.value = 1;

// FILE: node_modules/package-20/index.d.ts
export declare const value: number;
declare global {
  var fromPackage20: number | undefined;
}

// FILE: node_modules/package-21/package.json
{"name":"package-21","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-21/index.js
exports.value = 1;

// FILE: node_modules/package-21/index.d.ts
export declare const value: number;
declare global {
  var fromPackage21: number | undefined;
}

// FILE: node_modules/package-22/package.json
{"name":"package-22","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-22/index.js
exports.value = 1;

// FILE: node_modules/package-22/index.d.ts
export declare const value: number;
declare global {
  var fromPackage22: number | undefined;
}

// FILE: node_modules/package-23/package.json
{"name":"package-23","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-23/index.js
exports.value = 1;

// FILE: node_modules/package-23/index.d.ts
export declare const value: number;
declare global {
  var fromPackage23: number | undefined;
}

// FILE: node_modules/package-24/package.json
{"name":"package-24","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-24/index.js
exports.value = 1;

// FILE: node_modules/package-24/index.d.ts
export declare const value: number;
declare global {
  var fromPackage24: number | undefined;
}

// FILE: node_modules/package-25/package.json
{"name":"package-25","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-25/index.js
exports.value = 1;

// FILE: node_modules/package-25/index.d.ts
export declare const value: number;
declare global {
  var fromPackage25: number | undefined;
}

// FILE: node_modules/package-26/package.json
{"name":"package-26","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-26/index.js
exports.value = 1;

// FILE: node_modules/package-26/index.d.ts
export declare const value: number;
declare global {
  var fromPackage26: number | undefined;
}

// FILE: node_modules/package-27/package.json
{"name":"package-27","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-27/index.js
exports.value = 1;

// FILE: node_modules/package-27/index.d.ts
export declare const value: number;
declare global {
  var fromPackage27: number | undefined;
}

// FILE: node_modules/package-28/package.json
{"name":"package-28","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-28/index.js
exports.value = 1;

// FILE: node_modules/package-28/index.d.ts
export declare const value: number;
declare global {
  var fromPackage28: number | undefined;
}

// FILE: node_modules/package-29/package.json
{"name":"package-29","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-29/index.js
exports.value = 1;

// FILE: node_modules/package-29/index.d.ts
export declare const value: number;
declare global {
  var fromPackage29: number | undefined;
}

// FILE: node_modules/package-30/package.json
{"name":"package-30","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-30/index.js
exports.value = 1;

// FILE: node_modules/package-30/index.d.ts
export declare const value: number;
declare global {
  var fromPackage30: number | undefined;
}

// FILE: node_modules/package-31/package.json
{"name":"package-31","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-31/index.js
exports.value = 1;

// FILE: node_modules/package-31/index.d.ts
export declare const value: number;
declare global {
  var fromPackage31: number | undefined;
}

// FILE: node_modules/package-32/package.json
{"name":"package-32","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-32/index.js
exports.value = 1;

// FILE: node_modules/package-32/index.d.ts
export declare const value: number;
declare global {
  var fromPackage32: number | undefined;
}

// FILE: node_modules/package-33/package.json
{"name":"package-33","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-33/index.js
exports.value = 1;

// FILE: node_modules/package-33/index.d.ts
export declare const value: number;
declare global {
  var fromPackage33: number | undefined;
}

// FILE: node_modules/package-34/package.json
{"name":"package-34","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-34/index.js
exports.value = 1;

// FILE: node_modules/package-34/index.d.ts
export declare const value: number;
declare global {
  var fromPackage34: number | undefined;
}

// FILE: node_modules/package-35/package.json
{"name":"package-35","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-35/index.js
exports.value = 1;

// FILE: node_modules/package-35/index.d.ts
export declare const value: number;
declare global {
  var fromPackage35: number | undefined;
}

// FILE: node_modules/package-36/package.json
{"name":"package-36","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-36/index.js
exports.value = 1;

// FILE: node_modules/package-36/index.d.ts
export declare const value: number;
declare global {
  var fromPackage36: number | undefined;
}

// FILE: node_modules/package-37/package.json
{"name":"package-37","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-37/index.js
exports.value = 1;

// FILE: node_modules/package-37/index.d.ts
export declare const value: number;
declare global {
  var fromPackage37: number | undefined;
}

// FILE: node_modules/package-38/package.json
{"name":"package-38","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-38/index.js
exports.value = 1;

// FILE: node_modules/package-38/index.d.ts
export declare const value: number;
declare global {
  var fromPackage38: number | undefined;
}

// FILE: node_modules/package-39/package.json
{"name":"package-39","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-39/index.js
exports.value = 1;

// FILE: node_modules/package-39/index.d.ts
export declare const value: number;
declare global {
  var fromPackage39: number | undefined;
}

// FILE: node_modules/package-40/package.json
{"name":"package-40","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-40/index.js
exports.value = 1;

// FILE: node_modules/package-40/index.d.ts
export declare const value: number;
declare global {
  var fromPackage40: number | undefined;
}

// FILE: node_modules/package-41/package.json
{"name":"package-41","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-41/index.js
exports.value = 1;

// FILE: node_modules/package-41/index.d.ts
export declare const value: number;
declare global {
  var fromPackage41: number | undefined;
}

// FILE: node_modules/package-42/package.json
{"name":"package-42","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-42/index.js
exports.value = 1;

// FILE: node_modules/package-42/index.d.ts
export declare const value: number;
declare global {
  var fromPackage42: number | undefined;
}

// FILE: node_modules/package-43/package.json
{"name":"package-43","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-43/index.js
exports.value = 1;

// FILE: node_modules/package-43/index.d.ts
export declare const value: number;
declare global {
  var fromPackage43: number | undefined;
}

// FILE: node_modules/package-44/package.json
{"name":"package-44","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-44/index.js
exports.value = 1;

// FILE: node_modules/package-44/index.d.ts
export declare const value: number;
declare global {
  var fromPackage44: number | undefined;
}

// FILE: node_modules/package-45/package.json
{"name":"package-45","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-45/index.js
exports.value = 1;

// FILE: node_modules/package-45/index.d.ts
export declare const value: number;
declare global {
  var fromPackage45: number | undefined;
}

// FILE: node_modules/package-46/package.json
{"name":"package-46","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-46/index.js
exports.value = 1;

// FILE: node_modules/package-46/index.d.ts
export declare const value: number;
declare global {
  var fromPackage46: number | undefined;
}

// FILE: node_modules/package-47/package.json
{"name":"package-47","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-47/index.js
exports.value = 1;

// FILE: node_modules/package-47/index.d.ts
export declare const value: number;
declare global {
  var fromPackage47: number | undefined;
}

// FILE: node_modules/package-48/package.json
{"name":"package-48","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-48/index.js
exports.value = 1;

// FILE: node_modules/package-48/index.d.ts
export declare const value: number;
declare global {
  var fromPackage48: number | undefined;
}

// FILE: node_modules/package-49/package.json
{"name":"package-49","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-49/index.js
exports.value = 1;

// FILE: node_modules/package-49/index.d.ts
export declare const value: number;
declare global {
  var fromPackage49: number | undefined;
}

// FILE: node_modules/package-50/package.json
{"name":"package-50","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-50/index.js
exports.value = 1;

// FILE: node_modules/package-50/index.d.ts
export declare const value: number;
declare global {
  var fromPackage50: number | undefined;
}

// FILE: node_modules/package-51/package.json
{"name":"package-51","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-51/index.js
exports.value = 1;

// FILE: node_modules/package-51/index.d.ts
export declare const value: number;
declare global {
  var fromPackage51: number | undefined;
}

// FILE: node_modules/package-52/package.json
{"name":"package-52","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-52/index.js
exports.value = 1;

// FILE: node_modules/package-52/index.d.ts
export declare const value: number;
declare global {
  var fromPackage52: number | undefined;
}

// FILE: node_modules/package-53/package.json
{"name":"package-53","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-53/index.js
exports.value = 1;

// FILE: node_modules/package-53/index.d.ts
export declare const value: number;
declare global {
  var fromPackage53: number | undefined;
}

// FILE: node_modules/package-54/package.json
{"name":"package-54","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-54/index.js
exports.value = 1;

// FILE: node_modules/package-54/index.d.ts
export declare const value: number;
declare global {
  var fromPackage54: number | undefined;
}

// FILE: node_modules/package-55/package.json
{"name":"package-55","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-55/index.js
exports.value = 1;

// FILE: node_modules/package-55/index.d.ts
export declare const value: number;
declare global {
  var fromPackage55: number | undefined;
}

// FILE: node_modules/package-56/package.json
{"name":"package-56","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-56/index.js
exports.value = 1;

// FILE: node_modules/package-56/index.d.ts
export declare const value: number;
declare global {
  var fromPackage56: number | undefined;
}

// FILE: node_modules/package-57/package.json
{"name":"package-57","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-57/index.js
exports.value = 1;

// FILE: node_modules/package-57/index.d.ts
export declare const value: number;
declare global {
  var fromPackage57: number | undefined;
}

// FILE: node_modules/package-58/package.json
{"name":"package-58","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-58/index.js
exports.value = 1;

// FILE: node_modules/package-58/index.d.ts
export declare const value: number;
declare global {
  var fromPackage58: number | undefined;
}

// FILE: node_modules/package-59/package.json
{"name":"package-59","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/package-59/index.js
exports.value = 1;

// FILE: node_modules/package-59/index.d.ts
export declare const value: number;
declare global {
  var fromPackage59: number | undefined;
}
