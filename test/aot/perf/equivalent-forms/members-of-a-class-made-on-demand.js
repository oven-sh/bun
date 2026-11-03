// A class that a function makes when it is first asked for has a method, under a name and under a symbol, that some objects lack: the method is called on the object, or read, compared with undefined and then called. ../equivalent-forms.test.ts holds the pairs together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
const some = Symbol("some");
class Base {
  count = 0;
}
let Lazy;
function getLazy() {
  if (Lazy) return Lazy;
  Lazy = class Socket extends Base {
    plainSome(by) {
      this.count = (this.count + by) | 0;
      return this.count;
    }
    [some](by) {
      this.count = (this.count + by) | 0;
      return this.count;
    }
  };
  return Lazy;
}
const mixed = [new (getLazy())(), new (getLazy())(), new Base()];
function readPlain(object, i) {
  const method = object.plainSome;
  if (method !== undefined) return method.call(object, i);
  return 0;
}
function readSymbol(object, i) {
  const method = object[some];
  if (method !== undefined) return method.call(object, i);
  return 0;
}
const loops = {
  "a method under a plain name that is read, compared with undefined and called": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + readPlain(mixed[i & 1], i)) | 0;
    return sum;
  },
  "a method under a symbol that is read, compared with undefined and called": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + readSymbol(mixed[i & 1], i)) | 0;
    return sum;
  },
  "a method under a plain name that is called": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + mixed[i & 1].plainSome(i)) | 0;
    return sum;
  },
  "a method under a symbol that is called": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + mixed[i & 1][some](i)) | 0;
    return sum;
  },
};
if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
