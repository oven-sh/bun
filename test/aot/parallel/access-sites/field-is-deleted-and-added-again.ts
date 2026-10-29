// A field is deleted and added again, once and several times, the first, a middle and the last one. Reads, stores, `in` and the order of the keys follow.
class Record3 {
  first = "first";
  middle = 2;
  last = true;
}

function firstOf(value: Record3): unknown {
  return value.first;
}
function middleOf(value: Record3): unknown {
  return value.middle;
}
function lastOf(value: Record3): unknown {
  return value.last;
}
function setMiddle(value: Record3, to: number): void {
  value.middle = to;
}
function hasMiddle(value: Record3): boolean {
  return "middle" in value;
}
function state(mark: string, value: Record3): void {
  console.log(mark + ":", String(firstOf(value)), String(middleOf(value)), String(lastOf(value)), hasMiddle(value), Object.keys(value).join(), JSON.stringify(value));
}

const untouched = new Record3();
const changed = new Record3();
const open = changed as any;

state("at first", changed);
delete open.middle;
state("middle deleted", changed);
state("another one", untouched);
setMiddle(changed, 20);
state("middle stored again", changed);
delete open.middle;
open.extra = "extra";
state("deleted, another added", changed);
setMiddle(changed, 21);
state("middle after the other", changed);
delete open.first;
state("first deleted", changed);
open.first = "first again";
state("first again", changed);
delete open.last;
delete open.extra;
state("last and extra deleted", changed);
open.last = false;
state("last again", changed);
delete open.first;
delete open.middle;
delete open.last;
state("empty", changed);
open.first = "f";
open.middle = 3;
open.last = true;
state("filled in the old order", changed);
state("another one", untouched);

const literal = { first: "literal", middle: 5, last: false };
state("literal", literal);
delete (literal as any).last;
state("literal without last", literal);
literal.last = true;
state("literal with last", literal);
delete (literal as any).first;
literal.first = "back";
state("literal, first moved behind", literal);
setMiddle(literal, 6.5);
state("literal, a fraction", literal);

export {};
