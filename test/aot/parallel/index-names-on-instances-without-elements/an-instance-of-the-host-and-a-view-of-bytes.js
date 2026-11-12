const headers = new Headers({ a: "b" });
headers[0] = 5;
let sum = 0;
for (const value of Object.values(headers)) sum += value;
const view = new DataView(new ArrayBuffer(2));
view[0] = "dv";
for (const value of Object.values(view)) sum += value.length;
console.log(sum);
