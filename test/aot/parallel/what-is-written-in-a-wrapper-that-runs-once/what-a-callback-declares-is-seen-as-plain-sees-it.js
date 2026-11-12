// What a callback declares lives as long as the closures that it made: variables stored later, a dead zone met through a cycle of two wrappers, a callback that throws half way,
// a function that is called while its callback still runs, private names, accessors, static blocks.
// The names of a bundle's module bodies are variables of modules. The scope of another callback that runs at most once is never made: its variables lie in words of the instance. Three callbacks lean on "once" and stop at a second entry.
// STATISTIC: EnvironmentsPromotedToVariables >= 1
// COUNT: operation:operationAOTEnterBodyThatRunsOnce = 3
"use strict";
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var log = [];
var requireFirst = __commonJS((exports, module) => {
    exports.early = () => late;
    let tried;
    try { tried = requireSecond().peek(); } catch (error) { tried = error.constructor.name; }
    let late = "late";
    exports.tried = tried;
    exports.bump = () => ++counter;
    var counter = 10;
});
var requireSecond = __commonJS((exports, module) => {
    const first = requireFirst();
    exports.peek = () => first.early();
});
var requireBroken = __commonJS((exports, module) => {
    let steps = 0;
    exports.steps = () => ++steps;
    class Half { static { log.push("static block " + exports.steps()); } static get word() { return "word " + steps; } }
    exports.Half = Half;
    throw new Error("half way");
});
var Shape, shapes;
var initShape = __esm(() => {
    shapes = 0;
    Shape = class Shape {
        #sides;
        static #made = 0;
        constructor(sides) { this.#sides = sides; Shape.#made++; shapes++; }
        get sides() { return this.#sides; }
        set sides(value) { this.#sides = value * 2; }
        static get made() { return Shape.#made; }
        static is(object) { return #sides in object; }
    };
});
const first = requireFirst();
console.log(first.tried, first.early(), first.bump(), first.bump(), requireSecond().peek(), requireFirst() === first);
let message; try { requireBroken(); } catch (error) { message = error.message; }
const broken = requireBroken();
console.log(message, log.join(), broken.steps(), broken.Half.word, requireBroken() === broken);
initShape(); initShape();
const square = new Shape(4);
square.sides = 3;
console.log(square.sides, Shape.made, shapes, Shape.is(square), Shape.is({}), square instanceof Shape, Object.getOwnPropertyNames(Shape.prototype).join());
const counter = (() => { let counted = 0; return { next: () => ++counted, word: () => "counted " + counted }; })();
console.log(counter.next(), counter.next(), counter.word());
