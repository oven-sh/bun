// IR+ ^ .* = JSONSourceOpen v
interface Flat {
  id: number;
  name: string;
  ok: boolean;
  note: string | null;
}
const made: Flat = { id: 0, name: "made here", ok: false, note: null };
console.log(JSON.stringify(made));
function read(text: string): Flat {
  return JSON.parse(text);
}
function show(text: string) {
  try {
    const value = read(text);
    console.log(JSON.stringify(value), Object.keys(value as object).join());
  } catch (error) {
    console.log((error as Error).name + ":", (error as Error).message);
  }
}
show('{ "id": 1, "name": "中", "ok": true, "note": null }');
show('{"id":1,"name":"n","ok":true,"note":null}');
show('{"id":1,"name":"n","ok":true,"note":nul');
show('{"id":2,"name":"m","ok":false,"note":"x"}');
show('{"id":3,"name":"' + "中".repeat(40000) + '","ok":true,"note":5}');
show('{"id":4,"name":"after a large text","ok":true,"note":null}');
show('{"id":5,"name":"' + "a".repeat(200000) + '","ok":true');
show('{"id":6,"name":"after a large text that was cut","ok":true,"note":"é"}');
