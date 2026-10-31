// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// An imported JSON module is plain data without a declared type.
import catalog from "./files/catalog.json" with { type: "json" }
function ids(): string[] {
  const found: string[] = []
  for (const model of catalog.models) {
    found.push(model.id)
    for (const [provider, id] of Object.entries(model.providers)) {
      if (typeof id !== "string" || id === "") continue
      found.push(provider + ":" + id)
    }
  }
  return found
}
console.log(ids().join())
console.log(catalog.version, catalog.models.length, catalog.models[1].note, catalog.models.map(model => model.rank).join())
console.log(catalog.models.find(model => model.rank === 3)?.limits?.length, catalog.models.at(0)?.streaming?.a, catalog.models[2].streaming, catalog.models[3].streaming?.b)
const [first, ...rest] = catalog.models
console.log(first.id, rest.length, JSON.stringify(rest[0].streaming), Object.keys(first).join())

// FILE: files/catalog.json
{
  "version": 2,
  "models": [
    { "id": "one", "rank": 1, "providers": { "a": "one-a", "b": "" }, "streaming": { "a": true } },
    { "id": "two", "rank": 2, "providers": { "a": "two-a" }, "streaming": { "a": false, "b": true }, "note": "second" },
    { "id": "three", "rank": 3, "providers": {}, "limits": [1, 2, 3] },
    { "id": "four", "rank": 4, "providers": { "b": "four-b", "c": "four-c" }, "streaming": { "a": true, "b": false }, "hidden": true },
    { "id": "five", "rank": 5, "providers": { "a": "five-a", "b": "five-b", "c": "five-c" }, "note": "fifth", "hidden": false },
    { "id": "six", "rank": 6, "providers": { "c": "six-c" }, "streaming": { "a": true }, "limits": [], "alias": "vi" },
    { "id": "seven", "rank": 7, "providers": { "a": "seven-a", "d": "seven-d" }, "alias": "vii", "note": "seventh", "streaming": { "a": false } }
  ]
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
