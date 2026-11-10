// COUNTER: TransitionsCachedForParsedNames >= 1
// Three shapes by turns, in texts of their own: at its second coming a shape's transitions are found and laid into the cache; the objects are the same whichever road made them.
const shape = (k: number, i: number): string => k === 0 ? `{"p":${i},"q":"x${i}","r":true}` : k === 1 ? `{"q":"y${i}","p":${i},"s":null,"t":[${i}]}` : `{"u":{"p":${i}},"p":${i}}`;
const out: string[] = [];
for (let i = 0; i < 12; i++) { const made = JSON.parse(shape(i % 3, i)); out.push(Object.keys(made).join("") + ":" + JSON.stringify(made)); }
console.log(out.join(" "));
console.log(out.every((line, i) => line.endsWith(shape(i % 3, i))));
