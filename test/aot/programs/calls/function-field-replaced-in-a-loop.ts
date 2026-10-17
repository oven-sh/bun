// A field that holds one function is called in a loop and changed in the middle of the loop by code that the compiler cannot see through, each way of changing it on a class of its own.
const parts: string[] = ["st", "ep"];
function key(): string {
  return parts.join("");
}
const minus = (by: number): number => -by;
function storeByKey(target: any, value: unknown): void {
  target[key()] = value;
}
function removeByKey(target: any): void {
  delete target[key()];
}
function defineByKey(target: any, descriptor: PropertyDescriptor): void {
  Object.defineProperty(target, key(), descriptor);
}
function attempt(what: string, run: () => unknown): void {
  try {
    console.log(what, run());
  } catch (error) {
    console.log(what, "threw", error instanceof TypeError);
  }
}
type Change = (target: any, lender: any) => void;
const nothing: Change = () => {};

class StoreByKey {
  isStoreByKey = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}
function loopStoreByKey(c: StoreByKey, other: StoreByKey, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther + " " + c.total + " " + other.total;
}
attempt("a store by key: before", () => loopStoreByKey(new StoreByKey(), new StoreByKey(), 6, -1, nothing));
attempt("a store by key: in the loop", () => loopStoreByKey(new StoreByKey(), new StoreByKey(), 6, 3, (target, lender) => void storeByKey(target, minus)));
attempt("a store by key: new objects afterwards", () => loopStoreByKey(new StoreByKey(), new StoreByKey(), 6, -1, nothing));

class Deleted {
  isDeleted = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}
function loopDeleted(c: Deleted, other: Deleted, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther + " " + c.total + " " + other.total;
}
attempt("delete: before", () => loopDeleted(new Deleted(), new Deleted(), 6, -1, nothing));
attempt("delete: in the loop", () => loopDeleted(new Deleted(), new Deleted(), 6, 3, (target, lender) => void removeByKey(target)));
attempt("delete: new objects afterwards", () => loopDeleted(new Deleted(), new Deleted(), 6, -1, nothing));

class DefinedValue {
  isDefinedValue = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}
function loopDefinedValue(c: DefinedValue, other: DefinedValue, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther + " " + c.total + " " + other.total;
}
attempt("defineProperty with a value: before", () => loopDefinedValue(new DefinedValue(), new DefinedValue(), 6, -1, nothing));
attempt("defineProperty with a value: in the loop", () => loopDefinedValue(new DefinedValue(), new DefinedValue(), 6, 3, (target, lender) => void defineByKey(target, { value: minus, writable: true, configurable: true, enumerable: true })));
attempt("defineProperty with a value: new objects afterwards", () => loopDefinedValue(new DefinedValue(), new DefinedValue(), 6, -1, nothing));

class DefinedTogether {
  isDefinedTogether = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}
function loopDefinedTogether(c: DefinedTogether, other: DefinedTogether, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther + " " + c.total + " " + other.total;
}
attempt("defineProperties: before", () => loopDefinedTogether(new DefinedTogether(), new DefinedTogether(), 6, -1, nothing));
attempt("defineProperties: in the loop", () => loopDefinedTogether(new DefinedTogether(), new DefinedTogether(), 6, 3, (target, lender) => void Object.defineProperties(target, { [key()]: { value: minus, writable: true, configurable: true, enumerable: true } })));
attempt("defineProperties: new objects afterwards", () => loopDefinedTogether(new DefinedTogether(), new DefinedTogether(), 6, -1, nothing));

class Assigned {
  isAssigned = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}
function loopAssigned(c: Assigned, other: Assigned, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther + " " + c.total + " " + other.total;
}
attempt("Object.assign: before", () => loopAssigned(new Assigned(), new Assigned(), 6, -1, nothing));
attempt("Object.assign: in the loop", () => loopAssigned(new Assigned(), new Assigned(), 6, 3, (target, lender) => void Object.assign(target, { [key()]: minus })));
attempt("Object.assign: new objects afterwards", () => loopAssigned(new Assigned(), new Assigned(), 6, -1, nothing));

class ReflectSet {
  isReflectSet = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}
function loopReflectSet(c: ReflectSet, other: ReflectSet, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther + " " + c.total + " " + other.total;
}
attempt("Reflect.set: before", () => loopReflectSet(new ReflectSet(), new ReflectSet(), 6, -1, nothing));
attempt("Reflect.set: in the loop", () => loopReflectSet(new ReflectSet(), new ReflectSet(), 6, 3, (target, lender) => void Reflect.set(target, key(), minus)));
attempt("Reflect.set: new objects afterwards", () => loopReflectSet(new ReflectSet(), new ReflectSet(), 6, -1, nothing));

class ReflectDefine {
  isReflectDefine = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}
function loopReflectDefine(c: ReflectDefine, other: ReflectDefine, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther + " " + c.total + " " + other.total;
}
attempt("Reflect.defineProperty: before", () => loopReflectDefine(new ReflectDefine(), new ReflectDefine(), 6, -1, nothing));
attempt("Reflect.defineProperty: in the loop", () => loopReflectDefine(new ReflectDefine(), new ReflectDefine(), 6, 3, (target, lender) => void Reflect.defineProperty(target, key(), { value: minus, writable: true, configurable: true, enumerable: true })));
attempt("Reflect.defineProperty: new objects afterwards", () => loopReflectDefine(new ReflectDefine(), new ReflectDefine(), 6, -1, nothing));

class ReflectDelete {
  isReflectDelete = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}
function loopReflectDelete(c: ReflectDelete, other: ReflectDelete, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther + " " + c.total + " " + other.total;
}
attempt("Reflect.deleteProperty: before", () => loopReflectDelete(new ReflectDelete(), new ReflectDelete(), 6, -1, nothing));
attempt("Reflect.deleteProperty: in the loop", () => loopReflectDelete(new ReflectDelete(), new ReflectDelete(), 6, 3, (target, lender) => void Reflect.deleteProperty(target, key())));
attempt("Reflect.deleteProperty: new objects afterwards", () => loopReflectDelete(new ReflectDelete(), new ReflectDelete(), 6, -1, nothing));

class NotAFunction {
  isNotAFunction = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}
function loopNotAFunction(c: NotAFunction, other: NotAFunction, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther + " " + c.total + " " + other.total;
}
attempt("a number in its place: before", () => loopNotAFunction(new NotAFunction(), new NotAFunction(), 6, -1, nothing));
attempt("a number in its place: in the loop", () => loopNotAFunction(new NotAFunction(), new NotAFunction(), 6, 3, (target, lender) => void storeByKey(target, 7)));
attempt("a number in its place: new objects afterwards", () => loopNotAFunction(new NotAFunction(), new NotAFunction(), 6, -1, nothing));

class Borrowed {
  isBorrowed = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}
function loopBorrowed(c: Borrowed, other: Borrowed, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther + " " + c.total + " " + other.total;
}
attempt("the same function of another object: before", () => loopBorrowed(new Borrowed(), new Borrowed(), 6, -1, nothing));
attempt("the same function of another object: in the loop", () => loopBorrowed(new Borrowed(), new Borrowed(), 6, 3, (target, lender) => void storeByKey(target, lender[key()])));
attempt("the same function of another object: new objects afterwards", () => loopBorrowed(new Borrowed(), new Borrowed(), 6, -1, nothing));

class ReplacesItself {
  isReplacesItself = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    if (this.total === 3) storeByKey(this, minus);
    return this.total;
  };
}
function loopReplacesItself(c: ReplacesItself, rounds: number): string {
  let sum = "";
  for (let i = 0; i < rounds; i++) {
    sum += c.step(1) + ",";
    sum += c.step(1) + ";";
  }
  return sum + c.total;
}
attempt("the function replaces itself between two sites of one loop", () => loopReplacesItself(new ReplacesItself(), 4));
attempt("the function replaces itself: a new object afterwards", () => loopReplacesItself(new ReplacesItself(), 1));

class StoredInTheLoop {
  isStoredInTheLoop = true;
  total = 0;
  step = (by: number): number => {
    this.total += by;
    return this.total;
  };
}
function loopStoredInTheLoop(c: StoredInTheLoop, rounds: number, at: number): string {
  let sum = "";
  for (let i = 0; i < rounds; i++) {
    sum += c.step(1) + ",";
    if (i === at) storeByKey(c, minus);
    sum += c.step(1) + ";";
  }
  return sum + c.total;
}
attempt("a helper called in the loop, between two sites", () => loopStoredInTheLoop(new StoredInTheLoop(), 4, 1));
attempt("a helper called in the loop: a new object afterwards", () => loopStoredInTheLoop(new StoredInTheLoop(), 2, -1));

interface RecordStoreByKey {
  isRecordStoreByKey: boolean;
  total: number;
  step: (by: number) => number;
}
function makeRecordStoreByKey(): RecordStoreByKey {
  return { isRecordStoreByKey: true, total: 0, step: (by: number): number => by * 3 };
}
function loopRecordStoreByKey(c: RecordStoreByKey, other: RecordStoreByKey, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther;
}
attempt("a literal of a closed type, a store by key: before", () => loopRecordStoreByKey(makeRecordStoreByKey(), makeRecordStoreByKey(), 6, -1, nothing));
attempt("a literal of a closed type, a store by key: in the loop", () => loopRecordStoreByKey(makeRecordStoreByKey(), makeRecordStoreByKey(), 6, 3, (target, lender) => void storeByKey(target, minus)));
attempt("a literal of a closed type, a store by key: new objects afterwards", () => loopRecordStoreByKey(makeRecordStoreByKey(), makeRecordStoreByKey(), 6, -1, nothing));

interface RecordDeleted {
  isRecordDeleted: boolean;
  total: number;
  step: (by: number) => number;
}
function makeRecordDeleted(): RecordDeleted {
  return { isRecordDeleted: true, total: 0, step: (by: number): number => by * 3 };
}
function loopRecordDeleted(c: RecordDeleted, other: RecordDeleted, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther;
}
attempt("a literal of a closed type, delete: before", () => loopRecordDeleted(makeRecordDeleted(), makeRecordDeleted(), 6, -1, nothing));
attempt("a literal of a closed type, delete: in the loop", () => loopRecordDeleted(makeRecordDeleted(), makeRecordDeleted(), 6, 3, (target, lender) => void removeByKey(target)));
attempt("a literal of a closed type, delete: new objects afterwards", () => loopRecordDeleted(makeRecordDeleted(), makeRecordDeleted(), 6, -1, nothing));

interface RecordAssigned {
  isRecordAssigned: boolean;
  total: number;
  step: (by: number) => number;
}
function makeRecordAssigned(): RecordAssigned {
  return { isRecordAssigned: true, total: 0, step: (by: number): number => by * 3 };
}
function loopRecordAssigned(c: RecordAssigned, other: RecordAssigned, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther;
}
attempt("a literal of a closed type, Object.assign: before", () => loopRecordAssigned(makeRecordAssigned(), makeRecordAssigned(), 6, -1, nothing));
attempt("a literal of a closed type, Object.assign: in the loop", () => loopRecordAssigned(makeRecordAssigned(), makeRecordAssigned(), 6, 3, (target, lender) => void Object.assign(target, { [key()]: minus })));
attempt("a literal of a closed type, Object.assign: new objects afterwards", () => loopRecordAssigned(makeRecordAssigned(), makeRecordAssigned(), 6, -1, nothing));

interface RecordDefined {
  isRecordDefined: boolean;
  total: number;
  step: (by: number) => number;
}
function makeRecordDefined(): RecordDefined {
  return { isRecordDefined: true, total: 0, step: (by: number): number => by * 3 };
}
function loopRecordDefined(c: RecordDefined, other: RecordDefined, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther;
}
attempt("a literal of a closed type, defineProperty with a value: before", () => loopRecordDefined(makeRecordDefined(), makeRecordDefined(), 6, -1, nothing));
attempt("a literal of a closed type, defineProperty with a value: in the loop", () => loopRecordDefined(makeRecordDefined(), makeRecordDefined(), 6, 3, (target, lender) => void defineByKey(target, { value: minus, writable: true, configurable: true, enumerable: true })));
attempt("a literal of a closed type, defineProperty with a value: new objects afterwards", () => loopRecordDefined(makeRecordDefined(), makeRecordDefined(), 6, -1, nothing));

interface RecordNotAFunction {
  isRecordNotAFunction: boolean;
  total: number;
  step: (by: number) => number;
}
function makeRecordNotAFunction(): RecordNotAFunction {
  return { isRecordNotAFunction: true, total: 0, step: (by: number): number => by * 3 };
}
function loopRecordNotAFunction(c: RecordNotAFunction, other: RecordNotAFunction, rounds: number, at: number, change: Change): string {
  let sum = 0;
  let sumOfOther = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(c, other);
    sumOfOther += other.step(1);
    sum += c.step(1);
  }
  return sum + " " + sumOfOther;
}
attempt("a literal of a closed type, a number in its place: before", () => loopRecordNotAFunction(makeRecordNotAFunction(), makeRecordNotAFunction(), 6, -1, nothing));
attempt("a literal of a closed type, a number in its place: in the loop", () => loopRecordNotAFunction(makeRecordNotAFunction(), makeRecordNotAFunction(), 6, 3, (target, lender) => void storeByKey(target, 7)));
attempt("a literal of a closed type, a number in its place: new objects afterwards", () => loopRecordNotAFunction(makeRecordNotAFunction(), makeRecordNotAFunction(), 6, -1, nothing));

interface Api {
  get(id: number): number;
  step: (id: number) => number;
}
function makeApi(): Api {
  return {
    get(id: number): number {
      return id * 2;
    },
    step: (id: number): number => id * 3,
  };
}
function loopApi(api: Api, rounds: number, at: number, change: Change): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    if (i === at) change(api, api);
    sum += api.get(i) + api.step(i);
  }
  return sum;
}
function parsed(text: string): any {
  return JSON.parse(text);
}
function lookalike(): any {
  return { get: (id: number) => id + 1000, [key()]: (id: number) => id + 2000 };
}
attempt("a literal: before", () => loopApi(makeApi(), 6, -1, nothing));
attempt("a literal: changed in the loop", () => loopApi(makeApi(), 6, 3, (target) => storeByKey(target, minus)));
attempt("a literal: afterwards", () => loopApi(makeApi(), 6, -1, nothing));
attempt("parsed data at the literal's type", () => loopApi(parsed('{"get":null,"step":null}') as Api, 6, -1, nothing));
attempt("a lookalike made by untyped code", () => loopApi(lookalike() as Api, 6, -1, nothing));
