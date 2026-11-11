// RUN(MEMBER): link
// MEMBER: layout [[round]] {{*}}name="Round"
// MEMBER: layout {{*}}name="Wheel"{{*}}supertypes=[{{*}}[[round]]]

// RUN(METHOD): link
// METHOD: function {{*}}name="total" {{*}}functionTypes=[{{*}}[[ofLedger]]]
// METHOD: function [[ofLedger]] {{*}}role=Signature {{*}}functionTypes=[

// RUN(CONTENTS): link
// CONTENTS: layout [[titled]] {{*}}name="Titled"
// CONTENTS: layout {{*}}name="Book"{{*}}supertypes=[{{*}}[[titled]]]

// RUN(LISTED): link
// LISTED: function {{*}}name="log" {{*}}functionTypes=[{{*}}[[ofLog]]]
// LISTED: function [[ofLog]] {{*}}role=Signature {{*}}functionTypes=[

// RUN(PLACE): link
// PLACE: layout [[flat]] {{*}}name="Flat"
// PLACE: layout {{*}}name="Raised"{{*}}supertypes=[{{*}}[[flat]]]

// RUN(RESULT): link
// RESULT: layout [[keyed]] {{*}}name="Keyed"
// RESULT: layout {{*}}name="Entry"{{*}}supertypes=[{{*}}[[keyed]]]

// RUN(AWAITED): link
// AWAITED: layout [[sent]] {{*}}name="Sent"
// AWAITED: layout {{*}}name="Letter"{{*}}supertypes=[{{*}}[[sent]]]

// RUN(SPREAD): link
// SPREAD: layout [[lid]] {{*}}name="Lid"
// SPREAD: layout {{*}}name="Cap"{{*}}supertypes=[{{*}}[[lid]]]

// RUN(BACK): link
// BACK-NOT: layout {{*}}name="Round"{{*}}supertypes=
// BACK-NOT: layout {{*}}name="Titled"{{*}}supertypes=
// BACK-NOT: layout {{*}}name="Keyed"{{*}}supertypes=

// RUN(BELOW): link
// BELOW-NOT: layout {{*}}name="Frond"{{*}}supertypes=

// A cast declares a pair of types, and the pair brings its parts with it. Each part is read through the type that the target gives it: a member of an object, what a container
// holds, a place of a tuple, what a function returns. So the type of the part goes below that type, though nothing is written about the two by themselves. What a function returns
// and what a container holds are followed once more: `() => Promise<Letter>`. Nothing goes the other way, and nothing is followed below a member.
class Round {
  radius = 0;
}

class Wheel {
  radius = 1;
  spokes = 2;
}

interface Cart {
  wheel: Wheel;
  load: number;
}

interface Rolls {
  wheel: Round;
}

function roll(rolls: Rolls) {
  return rolls.wheel.radius;
}

export function pull(cart: Cart) {
  return roll(cart as Rolls);
}

interface Totals {
  total(): number;
}

class Ledger {
  total(): number {
    return 1;
  }
}

function sum(totals: Totals) {
  return totals.total();
}

export const summed = sum(new Ledger() as Totals);

class Titled {
  title = "";
}

class Book {
  title = "";
  pages = 1;
}

function count(all: Titled[]) {
  return all.length;
}

export function shelve(books: Book[]) {
  return count(books as Titled[]);
}

type Action = (times: number) => void;

function log(times: number) {
  console.log(times);
}

function runAll(actions: Action[]) {
  for (const action of actions) action(1);
}

const own = [log];
runAll(own as Action[]);

class Flat {
  width = 0;
}

class Raised {
  width = 1;
  height = 2;
}

function lay(pair: [number, Flat]) {
  return pair[1].width;
}

export function stack(pair: [number, Raised]) {
  return lay(pair as [number, Flat]);
}

class Keyed {
  key = "";
}

class Entry {
  key = "";
  value = 1;
}

function take(make: () => Keyed) {
  return make().key;
}

function makeEntry() {
  return new Entry();
}

export const taken = take(makeEntry as () => Keyed);

class Sent {
  address = "";
}

class Letter {
  address = "";
  stamp = 1;
}

async function post() {
  return new Letter();
}

async function deliver(send: () => Promise<Sent>) {
  return (await send()).address;
}

export const delivered = deliver(post as () => Promise<Sent>);

class Lid {
  rim = 0;
}

class Cap {
  rim = 1;
  brand = "";
}

interface Jar {
  lid: Cap;
  size: number;
}

interface Closed {
  lid: Lid;
  label: string;
}

export function close(jar: Jar): Closed {
  return { ...jar, label: "" } as Closed;
}

class Leaf {
  vein = 0;
}

class Frond {
  vein = 1;
  tip = 2;
}

interface Branch {
  leaves: Frond[];
  bark: number;
}

interface Limb {
  leaves: Leaf[];
}

function shade(limb: Limb) {
  return limb.leaves.length;
}

export function grow(branch: Branch) {
  return shade(branch as Limb);
}
