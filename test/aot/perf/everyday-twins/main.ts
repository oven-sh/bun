// Every loop of the files beside this one, by the name of its file and its own.
import { loops as aCommonJSFileImported } from "./a-commonjs-file-imported.js";
import { loops as aCompoundAssignment } from "./a-compound-assignment.js";
import { loops as aFieldThatIsCounted } from "./a-field-that-is-counted.ts";
import { loops as aKeyedStore } from "./a-keyed-store.js";
import { loops as aListFilledToABound } from "./a-list-filled-to-a-bound.ts";
import { loops as aRecordSpread } from "./a-record-spread.ts";
import { loops as aRecordWithoutOneOfItsNames } from "./a-record-without-one-of-its-names.ts";
import { loops as aRouter } from "./a-router.js";
import { loops as aRowWithoutTwoOfItsNames } from "./a-row-without-two-of-its-names.js";
import { loops as anEmitter } from "./an-emitter.js";
import { loops as characters } from "./characters.js";
import { loops as filter } from "./filter.ts";
import { loops as map } from "./map.ts";
import { loops as methodsThatAHelperStores } from "./methods-that-a-helper-stores.js";
import { loops as partsOfViews } from "./parts-of-views.js";
import { loops as sortByATable } from "./sort-by-a-table.js";
import { loops as textsCompared } from "./texts-compared.js";
import { loops as twoRecordsInOneLiteral } from "./two-records-in-one-literal.ts";

const all: Record<string, Record<string, (n: number) => number>> = {
  "a-commonjs-file-imported.js": aCommonJSFileImported,
  "a-compound-assignment.js": aCompoundAssignment,
  "a-field-that-is-counted.ts": aFieldThatIsCounted,
  "a-keyed-store.js": aKeyedStore,
  "a-list-filled-to-a-bound.ts": aListFilledToABound,
  "a-record-spread.ts": aRecordSpread,
  "a-record-without-one-of-its-names.ts": aRecordWithoutOneOfItsNames,
  "a-router.js": aRouter,
  "a-row-without-two-of-its-names.js": aRowWithoutTwoOfItsNames,
  "an-emitter.js": anEmitter,
  "characters.js": characters,
  "filter.ts": filter,
  "map.ts": map,
  "methods-that-a-helper-stores.js": methodsThatAHelperStores,
  "parts-of-views.js": partsOfViews,
  "sort-by-a-table.js": sortByATable,
  "texts-compared.js": textsCompared,
  "two-records-in-one-literal.ts": twoRecordsInOneLiteral,
};
const [file, loop, turns] = process.argv.slice(2);
if (file === undefined) for (const each of Object.keys(all)) for (const name of Object.keys(all[each]!)) console.log(each, name, all[each]![name]!(40));
else console.log(all[file]![loop!]!(Number(turns)));
