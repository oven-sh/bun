// Values reach constants of a primitive type through `any`: a list, an object, a function. Each is compared with an object by ===, !== or a switch, and then read, stored to or called under a key made at run time.
const marker = {};
const lengthKey: string = ["len", "gth"].join("");
const nameKey: string = ["na", "me"].join("");

const list: bigint = [1, 2, 3] as any;
switch (list as any) {
  case Float32Array as any:
    console.log("the list is a constructor");
}
console.log((list as any)[lengthKey as any]);

const second: bigint = [4, 5] as any;
if ((second as any) === marker) console.log("the second list is the marker");
console.log((second as any)[lengthKey]);

const third: string = [6] as any;
if ((third as any) !== marker) console.log("the third list is not the marker");
(third as any)[lengthKey] = 4;
console.log((third as any)[lengthKey], JSON.stringify(third));

const named: number = { name: "an object" } as any;
if ((named as any) === marker) console.log("the object is the marker");
console.log((named as any)[nameKey]);

const called: boolean = function greet() {
  return "called";
} as any;
if ((called as any) === marker) console.log("the function is the marker");
console.log((called as any)[nameKey], (called as any)[["ca", "ll"].join("")]());

const itself: symbol = marker as any;
if ((itself as any) === marker) console.log("the marker is the marker");
console.log((itself as any)[nameKey]);

function readUnder(value: bigint, key: string) {
  if ((value as any) === marker) return "the marker";
  return (value as any)[key];
}
for (let turn = 0; turn < 3; turn++) console.log(readUnder((turn ? [turn] : marker) as any, lengthKey));

const objectKey: string = {} as any;
const last: bigint = [1] as any;
switch (last as any) {
  case Float32Array as any:
}
console.log((last as any)[objectKey as any]);
console.log("end");
