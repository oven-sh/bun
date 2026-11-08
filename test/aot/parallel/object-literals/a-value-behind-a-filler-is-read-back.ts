// Row 3.9 lists a filler where a value is not proven to fit its slot, and defines the value by name behind the allocation.
// What the object holds under the name from then on is the value, whether it fits (5) or has left its slot ("text"), and the keys stand in the order in which they are written.
function readBack(text: string) { const x: any = JSON.parse(text); const o: { n: number; m: number } = { n: x, m: 1 }; return o.n; }
function has(text: string) { const x: any = JSON.parse(text); const o: { n: number; m: number } = { n: x, m: 1 }; return "n" in o; }
function storedOver(text: string) { const x: any = JSON.parse(text); const o: { n: number; m: number } = { n: x, m: 1 }; o.n = 2; return o.n + ":" + Object.keys(o).join() + ":" + JSON.stringify(o); }
function listed(text: string) { const x: any = JSON.parse(text); const o: { n: number; m: number } = { n: x, m: 1 }; return Object.keys(o).join() + ":" + JSON.stringify(o); }
for (const text of ["5", "7.5", "\"text\"", "null", "{}"]) console.log(String(readBack(text)), has(text), storedOver(text), listed(text));
