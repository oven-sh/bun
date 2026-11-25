// RUN: link
// CHECK: function {{*}}name="log"
// CHECK-NOT: functionTypes=
// CHECK: b0(

// RUN(UNPLACED): link
// UNPLACED: function {{*}}name="note"
// UNPLACED-NOT: functionTypes=
// UNPLACED: b0(

// RUN(NEW): link
// NEW: function {{*}}name="ring"
// NEW-NOT: functionTypes=
// NEW: b0(

// RUN(SUPER): link
// SUPER: function {{*}}name="buzz"
// SUPER-NOT: functionTypes=
// SUPER: b0(

// RUN(REST): link
// REST: layout {{*}}name="Fancy"
// REST-NOT: supertypes=
// REST: layout

// RUN(PLACES): link
// PLACES-NOT: layout {{*}}name="Cat"{{*}}supertypes=
// PLACES-NOT: layout {{*}}name="Dog"{{*}}supertypes=

// RUN(FRONT): link
// FRONT-NOT: layout {{*}}name="Key"{{*}}supertypes=

// RUN(DECLARED): link
// DECLARED: layout [[timer]] {{*}}name="Timer"
// DECLARED: layout {{*}}name="Alarm"{{*}}supertypes=[{{*}}[[timer]]]
// DECLARED: function {{*}}name="Timer" {{*}}functionTypes=[{{*}}[[ofTimer]]]
// DECLARED: function {{*}}name="Alarm" {{*}}functionTypes=[{{*}}[[ofAlarm]]]
// DECLARED: function [[ofAlarm]] {{*}}role=Signature {{*}}functionTypes=[{{*}}[[ofTimer]]]

// Passing an argument declares nothing, in a call with a spread as in any other, also in `new` and in `super(..)`. A function that is passed joins the family of no function type and
// an object goes below the type of no parameter, whether a tuple of fixed length or any other list is spread in front of it or behind it. The callee tests its parameters. What
// `extends` declares is listed, for the instances and for the constructors.
type Action = (count: number) => void;

function run(first: number, second: number, action: Action) {
  action(first + second);
}

function log(count: number) {
  console.log(count);
}

export function probe(pair: [number, number]) {
  run(...pair, log);
}

function runEach(...all: (number | Action)[]) {
  return all.length;
}

function note(count: number) {
  console.log(count);
}

export function probeEach(counts: number[]) {
  return runEach(...counts, note);
}

class Timer {
  constructor(
    public delay: number,
    public fire: Action,
  ) {}
}

function ring(count: number) {
  console.log(count);
}

export function arm(delay: [number]) {
  return new Timer(...delay, ring);
}

function buzz(count: number) {
  console.log(count);
}

export class Alarm extends Timer {
  constructor(...delay: [number]) {
    super(...delay, buzz);
  }
}

class Bare {
  side = 1;
}

class Fancy {
  side = 2;
  trim = 3;
}

function takeRest(...rest: [number, Bare]) {
  return rest[1].side;
}

export function pass(list: [number, Fancy]) {
  return takeRest(...list);
}

class Cat {
  lives = 9;
}

class Dog {
  legs = 4;
  tag = "";
}

function keep(cat: Cat, dog: Dog) {
  return cat.lives + dog.legs;
}

export function forward(...pair: [Cat, Dog]) {
  return keep(...pair);
}

class Key {
  cut = 1;
}

class Lock {
  cut = 2;
  pins = 3;
}

function open(key: Key, ...locks: Lock[]) {
  return key.cut + locks.length;
}

export function openAll(locks: Lock[]) {
  return open(new Key(), ...locks);
}
