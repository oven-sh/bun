import { next } from "@lib/counter.js";
import { next as sameNext } from "./lib/counter.js";
import { Pixel, sum } from "shapes";

/** @import { Point } from "shapes" */

/** @type {Point} */
const point = { x: 1, y: 2 };

/** @type {Point} */
const parsed = JSON.parse('{"x":"1","y":2}');

let total = 0;
for (let i = 0; i < 2000; i++) total += sum(point) + sum(new Pixel(i, 1));
console.log("2000 rounds: " + total);
console.log(next(), sameNext(), next === sameNext, sum(parsed), typeof parsed.x);
