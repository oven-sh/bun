interface Holder { label: string }
const parsed = JSON.parse('{"label":"parsed"}') as Holder;
try { console.log(parsed.label); } catch (error) { console.log("threw"); }
await 0;
const again = JSON.parse('[{"label":"text"}]') as Holder[];
console.log(parsed.label, again.length);
