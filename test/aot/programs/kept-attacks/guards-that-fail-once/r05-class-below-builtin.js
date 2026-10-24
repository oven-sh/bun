// Guards that fail once: class below builtin. It prints what plain Bun prints.
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 5000000);
const variant = process.argv[4] ?? "array";

class Plain {
  #hidden = 0;
  shown = 0;
  bumpHidden(amount) {
    this.#hidden = (this.#hidden + amount) | 0;
    return this.#hidden;
  }
  bumpShown(amount) {
    this.shown = (this.shown + amount) | 0;
    return this.shown;
  }
}
class BelowArray extends Array {
  #hidden = 0;
  shown = 0;
  bumpHidden(amount) {
    this.#hidden = (this.#hidden + amount) | 0;
    return this.#hidden;
  }
  bumpShown(amount) {
    this.shown = (this.shown + amount) | 0;
    return this.shown;
  }
}
class BelowError extends Error {
  #hidden = 0;
  shown = 0;
  bumpHidden(amount) {
    this.#hidden = (this.#hidden + amount) | 0;
    return this.#hidden;
  }
  bumpShown(amount) {
    this.shown = (this.shown + amount) | 0;
    return this.shown;
  }
}
class BelowMap extends Map {
  #hidden = 0;
  shown = 0;
  bumpHidden(amount) {
    this.#hidden = (this.#hidden + amount) | 0;
    return this.#hidden;
  }
  bumpShown(amount) {
    this.shown = (this.shown + amount) | 0;
    return this.shown;
  }
}
function runPlain(object, hidden) {
  let sum = 0;
  if (hidden) for (let i = 0; i < N; i++) sum = (sum + object.bumpHidden(i & 7)) | 0;
  else for (let i = 0; i < N; i++) sum = (sum + object.bumpShown(i & 7)) | 0;
  return sum;
}
function runArray(object, hidden) {
  let sum = 0;
  if (hidden) for (let i = 0; i < N; i++) sum = (sum + object.bumpHidden(i & 7)) | 0;
  else for (let i = 0; i < N; i++) sum = (sum + object.bumpShown(i & 7)) | 0;
  return sum;
}
function runError(object, hidden) {
  let sum = 0;
  if (hidden) for (let i = 0; i < N; i++) sum = (sum + object.bumpHidden(i & 7)) | 0;
  else for (let i = 0; i < N; i++) sum = (sum + object.bumpShown(i & 7)) | 0;
  return sum;
}
function runMap(object, hidden) {
  let sum = 0;
  if (hidden) for (let i = 0; i < N; i++) sum = (sum + object.bumpHidden(i & 7)) | 0;
  else for (let i = 0; i < N; i++) sum = (sum + object.bumpShown(i & 7)) | 0;
  return sum;
}
const [base, field] = variant.split("-");
const hidden = field === "hidden";
let sum;
if (!trip) sum = runPlain(new Plain(), hidden);
else if (base === "array") sum = runArray(new BelowArray(), hidden);
else if (base === "error") sum = runError(new BelowError("x"), hidden);
else sum = runMap(new BelowMap(), hidden);
console.log(variant, sum);
