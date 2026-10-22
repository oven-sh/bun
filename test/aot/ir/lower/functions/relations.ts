// RUN: lower
// OPTIONS: relations
// The functions come in the order of their names.
// CHECK: name="all"{{*}} relations={subjects=[{fate=[IsIncomplete]}, {index=1 fate=[IsIncomplete]}, {{*}}] stores=[{{*}}]} {
// CHECK: name="apply"{{*}} relations={subjects=[{fate=[IsCalled]}, {index=1}, {kind=CallResult index=[[applied]] fate=[IsReturned] results=1}] handed=[{call=[[applied]]}, {source=1 call=[[applied]] argument=2}] resultsFullyListed=1} {
// CHECK: name="capture"{{*}} relations={subjects=[{}, {kind=Allocation index=[[closure]] fate=[IsReturned] results=1}] handed=[{call=[[closure]]}] resultsFullyListed=1} {
// CHECK: name="either"{{*}} relations={subjects=[{}, {index=1 fate=[IsReturned] results=1}, {index=2 fate=[IsReturned] results=1}] resultsFullyListed=1} {
// CHECK: name="element"{{*}} relations={subjects=[{fate=[HasMembersRead]}, {index=1 fate=[IsConvertedToPrimitive]}, {kind=ReadFrom index={{*}} fate=[IsReturned] results=1}] operands=[{source=1 user=2 position=1}] resultsFullyListed=1} {
// CHECK: name="fail"{{*}} relations={subjects=[{fate=[IsThrown]}] resultsFullyListed=1} {
// CHECK: name="first"{{*}} relations={subjects=[{fate=[HasMembersRead, IsIterated]}, {kind=Constant index={{*}} fate=[IsReturned] results=1}, {{*}}, {kind=ReadFrom index={{*}} fate=[IsReturned] results=1}] resultsFullyListed=1} {
// CHECK: name="identity"{{*}} relations={subjects=[{fate=[IsReturned] results=1}] resultsFullyListed=1} {
// CHECK: name="keep"{{*}} relations={subjects=[{fate=[IsStoredInVariable]}, {{*}}] resultsFullyListed=1} {
// CHECK: name="later"{{*}} relations={subjects=[{fate=[IsReturned, IsStoredInUnknownObject, HasMembersRead] results=1}] resultsFullyListed=1} {
// CHECK: name="member"{{*}} relations={subjects=[{fate=[HasMembersRead]}, {kind=ReadFrom index={{*}} key="a" fate=[HasMembersRead]}, {kind=ReadFrom index={{*}} source=1 key="b" fate=[IsReturned] results=1}] resultsFullyListed=1} {
// CHECK: name="method"{{*}} relations={subjects=[{fate=[HasMembersRead]}, {index=1}, {kind=CallResult index=[[called]] fate=[IsReturned] results=1}, {kind=ReadFrom index={{*}} key="m" fate=[IsCalled]}] handed=[{source=3 call=[[called]]}, {call=[[called]] argument=1}, {source=1 call=[[called]] argument=2}] resultsFullyListed=1} {
// CHECK: name="pair"{{*}} relations={subjects=[{}, {index=1}, {kind=Allocation index={{*}} fate=[IsReturned] results=1}] stores=[{target=2 creationOperand=1 isOnEveryPath=true isBeforeTargetLeaves=true}, {source=1 target=2 creationOperand=2 isOnEveryPath=true isBeforeTargetLeaves=true}] resultsFullyListed=1} {
// CHECK: name="store"{{*}} relations={subjects=[{fate=[HasMembersWritten]}, {index=1}, {kind=Constant index={{*}} fate=[IsReturned] results=1}] stores=[{source=1 key="a" isOnEveryPath=true isBeforeTargetLeaves=true}] resultsFullyListed=1} {
// CHECK: name="text"{{*}} relations={subjects=[{fate=[IsConvertedToPrimitive]}, {kind=Constant index={{*}} fate=[IsConvertedToPrimitive]}, {kind=Computed index={{*}} fate=[IsConvertedToPrimitive]}, {kind=Computed index={{*}} fate=[IsReturned] results=1}] operands=[{user=2}, {source=2 user=3}, {source=1 user=3 position=1}] resultsFullyListed=1} {

export function identity(x: unknown) {
  return x;
}

export function member(o: { a: { b: number } }) {
  return o.a.b;
}

export function store(o: { a: unknown }, v: unknown) {
  o.a = v;
}

export function pair(x: number, y: string) {
  return { x, y };
}

export function capture(x: number) {
  return () => x;
}

export function apply(f: (v: unknown) => unknown, v: unknown) {
  return f(v);
}

export function method(o: { m(v: unknown): unknown }, v: unknown) {
  return o.m(v);
}

export function element(a: number[], i: number) {
  return a[i];
}

export function either(c: boolean, x: unknown, y: unknown) {
  return c ? x : y;
}

export function text(x: number) {
  return `${x}!`;
}

export function first(xs: Iterable<unknown>) {
  for (const x of xs) return x;
}

export function keep(x: unknown) {
  kept = x;
}
let kept: unknown;

export async function later(x: unknown) {
  return x;
}

export function all(x: unknown) {
  return arguments.length;
}

export function fail(x: unknown) {
  throw x;
}
