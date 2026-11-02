// One file is asked for as two types that share a place in the loader, so every statement gets what the first one made: what a statement names is not what it gets.
// The build may not answer `typeof`, a comparison or a branch from the type that the statement names.
import object from "./object.json" with { type: "yaml" };
import namedText from "./object.json" with { type: "text" };
import text from "./text.json" with { type: "text" };
import namedObject from "./text.json" with { type: "json5" };
import five from "./five.json" with { type: "yaml" };
import namedFiveAsText from "./five.json" with { type: "text" };
import fiveAsText from "./five-as-text.json" with { type: "text" };
import namedFive from "./five-as-text.json" with { type: "jsonc" };
import yes from "./space.json" with { type: "json5" };
import * as space from "./space.json" with { type: "text" };
// The loader goes through the graph level by level, so this statement decides for the one in below.mjs, which the build reads first.
import { held, kindOfHeld, isHeldText } from "./below.mjs";
import near from "./depth.json" with { type: "yaml" };
// Nobody else asks for this one: it is the text that it names.
import alone from "./alone.json" with { type: "text" };

const show = (label, kind, value) => console.log(label + ":", kind, JSON.stringify(value));
show("yaml", typeof object, object);
show("text behind yaml", typeof namedText, namedText);
console.log(typeof namedText === "string" ? "a string" : "no string", namedText === object);
show("text", typeof text, text);
show("json5 behind text", typeof namedObject, namedObject);
console.log(typeof namedObject === "object" ? "an object" : "no object", namedObject === text);

show("yaml of 5", typeof five, five);
show("text behind yaml of 5", typeof namedFiveAsText, namedFiveAsText);
console.log(namedFiveAsText === 5, namedFiveAsText === "5\n", typeof namedFiveAsText === "number" ? namedFiveAsText * 2 : "no number");
if (namedFiveAsText === "5\n") console.log("the text was taken");
show("text of 5", typeof fiveAsText, fiveAsText);
show("jsonc behind text of 5", typeof namedFive, namedFive);
console.log(namedFive === 5, namedFive === "5\n", typeof namedFive === "number" ? namedFive * 2 : "no number");
if (namedFive === 5) console.log("the number was taken");

show("json5 of true", typeof yes, yes);
show("the namespace of a text behind it", typeof space.default, space.default);
console.log(space.default === true ? "true" : "not true", !space.default);

show("yaml, nearer to the entry point", typeof near, near);
show("text, farther from it", typeof held, held);
console.log(kindOfHeld, isHeldText ? "text below" : "no text below", held === near);

show("text that nobody else asks for", typeof alone, alone);
console.log(typeof alone === "string" ? "a string" : "no string");
