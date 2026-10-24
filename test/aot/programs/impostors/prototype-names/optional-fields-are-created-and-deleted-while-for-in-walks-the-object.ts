// for-in takes its list of names at the start, but a name that is deleted before its turn must be left out, and a name created during the walk is not visited.
// The body of the loop stores optional fields for the first time, deletes others, deletes and stores again, and puts an enumerable name on the prototype in the middle.
class Walked {
  declare a?: number;
  declare b?: number;
  declare c?: number;
  declare d?: number;
  declare e?: number;
}
function make(names: string) {
  const walked = new Walked();
  for (const name of names) (walked as any)[name] = name.charCodeAt(0);
  return walked;
}
function fillTyped(walked: Walked) {
  walked.a = 1;
  walked.c = 3;
  walked.e = 5;
  return walked;
}
function walk(walked: Walked, during: (name: string, walked: Walked) => void) {
  const seen: string[] = [];
  for (const name in walked) {
    seen.push(name);
    during(name, walked);
  }
  return `${seen.join("")} then ${Object.keys(walked).join("")}`;
}
function createB(name: string, walked: Walked) {
  if (name === "a") walked.b = 2;
}
function deleteE(name: string, walked: Walked) {
  if (name === "a") delete walked.e;
}
function deleteAndRestoreE(name: string, walked: Walked) {
  if (name === "a") {
    delete walked.e;
    walked.e = 50;
  }
}
function deleteCurrent(name: string, walked: Walked) {
  delete (walked as any)[name];
}
function deleteAllAtOnce(name: string, walked: Walked) {
  if (name === "a") {
    delete walked.c;
    delete walked.e;
    walked.d = 4;
  }
}

let length = 0;
for (let i = 0; i < 3000; i++) length += walk(fillTyped(new Walked()), i & 1 ? createB : deleteE).length;
console.log("warm", length);

console.log("nothing happens:", walk(fillTyped(new Walked()), () => {}));
console.log("b is created:", walk(fillTyped(new Walked()), createB));
console.log("e is deleted before its turn:", walk(fillTyped(new Walked()), deleteE));
console.log("e is deleted and stored again:", walk(fillTyped(new Walked()), deleteAndRestoreE));
console.log("each is deleted at its turn:", walk(fillTyped(new Walked()), deleteCurrent));
console.log("the rest is deleted, another created:", walk(fillTyped(new Walked()), deleteAllAtOnce));
console.log("other orders of creation:", walk(make("edcba"), deleteE), "|", walk(make("bd"), createB), "|", walk(make("ea"), deleteAndRestoreE));
const holder: any = Object.getPrototypeOf(new Walked());
console.log(
  "the prototype gets d in the middle:",
  walk(fillTyped(new Walked()), name => {
    if (name === "a") holder.d = 40;
  }),
);
console.log("d is inherited from the start:", walk(fillTyped(new Walked()), () => {}), "|", walk(fillTyped(new Walked()), (name, walked) => { if (name === "a") walked.d = 4; }));
console.log(
  "the prototype loses d in the middle:",
  walk(fillTyped(new Walked()), name => {
    if (name === "a") delete holder.d;
  }),
);
console.log("gone again:", walk(fillTyped(new Walked()), () => {}));
