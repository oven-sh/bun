import { numbersUpTo, put, take } from "./out-of-sight.js";

function kept(name, value) {
  put(name, value);
  return take(name);
}

function triple(value) {
  return value * 3;
}

function callHundredTimes(callback) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += callback(i);
  return total;
}

function callThroughCall(callback) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += callback.call(undefined, i);
  return total;
}

function half(value) {
  return value / 2;
}

function quarter(value) {
  return value / 4;
}

let chosen = half;

function chooseOther() {
  chosen = chosen === half ? quarter : half;
}

function callTheChosen(count) {
  let total = 0;
  for (let i = 0; i < count; i++) total += chosen(i);
  chooseOther();
  return total;
}

function lastOfHundred(list) {
  return list[99];
}

function passedOn(list) {
  return lastOfHundred(list);
}

function argumentOfAnotherFunction(list) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += passedOn(list);
  return total;
}

function areaOfThis() {
  return this.plotWidth * this.plotDepth;
}

function calledWithReceiver(plots) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += areaOfThis.call(plots[i]);
  return total;
}

function addThree(a, b, c) {
  return a + b + c;
}

function appliedToList(list) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += addThree.apply(undefined, list);
  return total;
}

function squareOfVisible(value) {
  return value * value;
}

function everyCallerIsVisible() {
  let total = 0;
  for (let i = 0; i < 100; i++) total += squareOfVisible(i);
  return total;
}

function mapAndSum(list) {
  let total = 0;
  for (const value of list.map(entry => entry + 1)) total += value;
  return total;
}

const steps = [
  value => value + 1,
  value => value + 2,
  value => value + 3,
  value => value + 4,
  value => value + 5,
  value => value + 6,
];

function callEachStep(count) {
  let total = 0;
  for (let i = 0; i < count; i++) total = steps[i % 6](total);
  return total;
}

function plots() {
  const made = [];
  for (let i = 0; i < 100; i++) made.push({ plotWidth: i, plotDepth: 2 });
  return made;
}

function capturedList(list) {
  return function turnOfCapturedList() {
    let total = 0;
    for (let i = 0; i < 100; i++) total += list[i];
    return total;
  };
}

export const cases = {
  "a value is called": { prepare: () => kept("callback", triple), turn: callHundredTimes },
  "the call method of a value is called": { prepare: () => kept("callback", triple), turn: callThroughCall },
  "a variable holds one of two functions": { prepare: () => kept("count", 100), turn: callTheChosen },
  "a value is handed on to a function that reads an element": {
    prepare: () => numbersUpTo(100),
    turn: argumentOfAnotherFunction,
  },
  "a function reads members of this": { prepare: () => kept("plots", plots()), turn: calledWithReceiver },
  "a list is applied to a function": { prepare: () => numbersUpTo(3), turn: appliedToList },
  "a captured value is read under a number": { prepare: () => 0, turn: capturedList(numbersUpTo(100)) },
  "every caller of a function is in sight": { prepare: () => 0, turn: everyCallerIsVisible },
  "a callback is handed to map": { prepare: () => numbersUpTo(100), turn: mapAndSum },
  "one of six functions in a list is called": { prepare: () => kept("count", 100), turn: callEachStep },
};
