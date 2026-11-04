// Prints the names of classes without a name that have class decorators, and what each decorator is told. Such a class has the name of the declaration that holds it, also where a namespace exports that name: the declaration runs as the store `N.Declared = ..`, which names no function and no other class. So has the default of such a name in an assigned list, but not in an assigned record.
const told: string[] = [];
function on(value: any, context: any) {
  told.push(String(context.name));
  return value;
}
namespace N {
  export const Declared = @on class {};
  export let DeclaredByLet = @on class {};
  export var DeclaredByVar = @on class {};
  export const Asserted = (@on class {}) as any;
  export const [InList = @on class {}] = [] as any[];
  export const { InRecord = @on class {} } = {} as any;
  export const { key: Renamed = @on class {} } = {} as any;
  export const OwnName = @on class Inner {};
  export let Assigned: any;
  Assigned = @on class {};
  export let InAssignedList: any, InAssignedRecord: any, RenamedInAssignedRecord: any;
  [InAssignedList = @on class {}] = [] as any[];
  ({ InAssignedRecord = @on class {} } = {} as any);
  ({ key: RenamedInAssignedRecord = @on class {} } = {} as any);
  export let InLoopHead: any, InListInRecord: any, InListInList: any, InRecordInList: any;
  for ([InLoopHead = @on class {}] of [[]] as any[]) {
  }
  ({ key: [InListInRecord = @on class {}] } = { key: [] } as any);
  [[InListInList = @on class {}]] = [[]] as any;
  [{ InRecordInList = @on class {} }] = [{}] as any;
  export let AssertedInAssignedList: any, UndecoratedInAssignedList: any, madeInAssignedList: any;
  [AssertedInAssignedList = (@on class {}) as any] = [] as any[];
  [UndecoratedInAssignedList = class {}] = [] as any[];
  [madeInAssignedList = function () {}] = [] as any[];
  export const Undecorated = class {};
  export const made = function () {};
  export const MemberAlone = class {
    @((method: any) => method) run() {}
  };
  export const [UndecoratedInList = class {}] = [] as any[];
}
function make() {
  const Returned = @on class {};
  return Returned;
}
const Stored = @on class {};
const Cast = (@on class {}) as any;
let Assigned: any;
Assigned = @on class {};
const [InList = @on class {}] = [] as any[];
let InAssignedList: any, InAssignedRecord: any;
[InAssignedList = @on class {}] = [] as any[];
({ InAssignedRecord = @on class {} } = {} as any);
const names = (...values: any[]) => JSON.stringify(values.map(value => value.name));
console.log(names(N.Declared, N.DeclaredByLet, N.DeclaredByVar, N.Asserted, N.InList, N.InRecord, N.Renamed, N.OwnName));
console.log(names(N.Assigned, N.Undecorated, N.made, N.MemberAlone, N.UndecoratedInList));
console.log(names(N.InAssignedList, N.InLoopHead, N.InListInRecord, N.InListInList, N.AssertedInAssignedList));
console.log(names(N.InAssignedRecord, N.RenamedInAssignedRecord, N.InRecordInList, N.UndecoratedInAssignedList, N.madeInAssignedList));
console.log(names(make(), Stored, Cast, Assigned, InList, InAssignedList, InAssignedRecord));
console.log(JSON.stringify(told));
