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
