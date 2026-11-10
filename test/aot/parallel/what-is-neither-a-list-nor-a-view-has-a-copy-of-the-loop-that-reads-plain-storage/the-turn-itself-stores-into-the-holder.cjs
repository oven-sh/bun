// STATISTIC: OrdinaryObjectElementsReadDirectly >= 1
"use strict";
// The text of the turn stores: into the place read next, into the length, past the end, a fraction or a text where int32s lay (the storage changes its kind and moves), and deletes a place.
const said = [];
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
function next(like) { let s = 0; for (let j = 0; j < like.length; j++) { s += like[j]; like[j + 1] = s; if (j > 6) break; } return s; }
function shorter(like) { let s = 0; for (let j = 0; j < like.length; j++) { s += like[j]; if (j === 1) like.length = 3; } return s; }
function longer(like) { let s = 0; for (let j = 0; j < like.length; j++) { s += like[j]; if (j < 3) { like[like.length] = j; like.length++; } } return s; }
function kind(like, stored) { let s = 0; for (let j = 0; j < like.length; j++) { s += like[j]; if (j === 0) like[2] = stored; } return s; }
function gone(like) { let s = 0; for (let j = 0; j < like.length; j++) { s += like[j] === undefined ? 100 : like[j]; if (j === 0) delete like[2]; } return s; }
function far(like) { let s = 0; for (let j = 0; j < like.length; j++) { s += like[j]; if (j === 1) like[900000] = 1; } return s; }
for (let round = 0; round < 3; round++) said.push(next(fresh()), shorter(fresh()), longer(fresh()), kind(fresh(), 0.5), kind(fresh(), "x"), kind(fresh(), 70), String(kind(fresh(), undefined)), gone(fresh()), far(fresh()));
console.log(said.join(" "));
