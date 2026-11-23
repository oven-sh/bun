// RUN: lower
// OPTIONS: builtin-modules

// The forms of a harbor: one function begins every form, another adds what a stamped form holds, and the function of each sort of form fills in the rest. Two sorts share one type that names no sort, and a smaller type names one of the two.
type Open<T> = { -readonly [K in keyof T]: T[K] };
interface Stamp { ink: string }
interface Form { readonly sort: number; readonly first: number; readonly last: number; readonly marks: number; readonly folder: Form }
interface Word extends Form { readonly sort: 1; readonly letters: string }
interface Stamped extends Form { stamp: Stamp; ownStamp?: Stamp }
interface Slip extends Form { readonly folder: Form; readonly heading: Word; readonly note?: string }
interface CargoSlip extends Slip, Stamped { readonly ware: Word; readonly weight?: Form; readonly isUrgent: boolean; readonly isFragile: boolean }
interface CrateSlip extends CargoSlip { readonly sort: 2 }
interface SackSlip extends CargoSlip { readonly sort: 3 }
interface RuleSlip extends Slip { readonly sort: 4; readonly limit: Form | undefined }
function PaperForm(this: Open<Form>, sort: number, first: number, last: number) { this.sort = sort; this.marks = 0; this.first = first; this.last = last; this.folder = undefined!; }
const press = { formMaker: () => PaperForm as any as new (sort: number, first: number, last: number) => Form };
let Paper: (new (sort: number, first: number, last: number) => Form) | undefined;
const desk = {
  begin(sort: number): Form {
    Paper ??= press.formMaker();
    return new Paper(sort, -1, -1);
  },
};
function beginForm<T extends Form>(sort: T["sort"]) { return desk.begin(sort) as Open<T>; }
function beginStamped<T extends Stamped>(sort: T["sort"]) { const form = beginForm<T>(sort); form.ownStamp = undefined; form.stamp = undefined!; return form; }
function beginSlip<T extends Slip>(sort: T["sort"], heading: Word, note: string | undefined) { const form = beginForm<T>(sort); form.note = note; form.heading = heading; return form; }
function beginStampedSlip<T extends Slip & Stamped>(sort: T["sort"], heading: Word, note: string | undefined) { const form = beginStamped<T>(sort); form.note = note; form.heading = heading; return form; }
function word(letters: string): Word { const form = beginForm<Word>(1); form.letters = letters; return form; }
function sackSlip(ware: Word, isFragile: boolean, heading?: Word, weight?: Form, isUrgent?: boolean, note?: string): SackSlip {
  const form = beginStampedSlip<SackSlip>(3, heading ?? word("sack"), note);
  form.isFragile = isFragile;
  form.isUrgent = !!isUrgent;
  form.ware = ware;
  form.weight = weight;
  return form;
}
function crateSlip(ware: Word, isFragile: boolean, heading?: Word): CrateSlip {
  const form = beginStampedSlip<CrateSlip>(2, heading ?? word("crate"), undefined);
  form.isFragile = isFragile;
  form.isUrgent = false;
  form.ware = ware;
  form.weight = undefined;
  return form;
}
function ruleSlip(limit: Form | undefined): RuleSlip { const form = beginSlip<RuleSlip>(4, word("rule"), undefined); form.limit = limit; return form; }
interface Called extends Form { readonly sort: 3 | 6; readonly ware: Word }
interface Lot extends Called { readonly sort: 6 }
function beginCalled<T extends Called>(sort: T["sort"], ware: Word) { const form = beginForm<T>(sort); form.ware = ware; return form; }
function lot(ware: Word): Lot { return beginCalled<Lot>(6, ware); }
function wareOf(called: Called): string { return called.sort + called.ware.letters; }
function told(slip: CargoSlip): string { return [slip.sort, slip.heading.letters, slip.ware.letters, slip.isFragile, slip.isUrgent, slip.note ?? "-"].join(":"); }
const slips: Slip[] = [];
for (let turn = 0; turn < 3; turn++) {
  const sack = sackSlip(word("wheat " + turn), turn === 1, undefined, undefined, true, "note " + turn);
  const crate = crateSlip(word("lamps " + turn), false, word("glass"));
  slips.push(sack, crate, ruleSlip(sack));
  console.log(told(sack), told(crate));
}
console.log(wareOf(lot(word("rope"))));
console.log(slips.map(slip => slip.sort + slip.heading.letters).join());

// CHECK-LABEL: function {{*}}name="beginForm"
// CHECK-LABEL: function {{*}}name="beginCalled"
// CHECK-LABEL: function {{*}}name="sackSlip"
// CHECK-LABEL: function {{*}}name="formMaker"
// CHECK-LABEL: function {{*}}name="begin"
