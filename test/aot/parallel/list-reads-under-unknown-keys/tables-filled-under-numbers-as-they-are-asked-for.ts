// tables that are filled as they are asked for, under what a call gives, a parameter, a field: as a host keeps slips of paper about guests
class Slip { drinks = 0; constructor(public of: number) {} }
class Guest { seat = 0; constructor(public table: number) {} }
let nextSeat = 1;
const slips: Slip[] = [];
const byTable: (Slip | undefined)[] = [];
const names: string[] = [];
function seatOf(guest: Guest): number { return guest.seat || (guest.seat = nextSeat++); }
function slipOf(guest: Guest): Slip { const seat = seatOf(guest); return slips[seat] || (slips[seat] = new Slip(seat * 2)); }
function slipOfTable(guest: Guest): Slip { return byTable[guest.table] ??= new Slip(-guest.table); }
function nameOf(kind: any): string { return names[kind] || (names[kind] = "kind " + String(kind)); }
const guests: Guest[] = [];
for (let i = 0; i < 300; i++) guests.push(new Guest(i % 7));
let sum = 0;
for (let round = 0; round < 5; round++) for (const guest of guests) { const slip = slipOf(guest); slip.drinks += round; sum += slip.drinks + slip.of + slipOfTable(guest).of; }
console.log(sum, slips.length, byTable.length, slips[0], slips[300].of);
console.log(nameOf(1), nameOf("1"), nameOf(2.5), nameOf(-1), nameOf("x"), nameOf(1), names.length, Object.keys(names).join());
