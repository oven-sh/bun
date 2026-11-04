// A long list of records is parsed by the written type of its elements, and here and there stands an element of another kind: each element is what JSON.parse makes of it, and the loop over the list reads them all.
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a layout that parsers make
type Item = { id: number; label: string };
function load(text: string) { return JSON.parse(text) as Item[]; }
function total(items: Item[]) { let sum = ""; for (const item of items) sum += item && typeof item === "object" ? String(item.id) + String(item.label) + ";" : String(item) + ";"; return sum; }
const odd = ["7", "null", '"text"', "[1,2]", "{}", '{"id":"text","label":1}', '{"id":1}', '{"label":"only"}', "true", '{"id":1,"label":"x","id":"twice"}', '{"id":1.5,"label":""}'];
for (let place = 0; place < 12; place++) {
  for (const element of odd) {
    const parts: string[] = [];
    for (let i = 0; i < 12; i++) parts.push(i === place ? element : `{"id":${i},"label":"l${i}"}`);
    console.log(total(load("[" + parts.join(",") + "]")));
  }
}
