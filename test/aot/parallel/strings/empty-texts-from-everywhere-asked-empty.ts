// Empty texts that the language, the library and native code make, and texts of one unit beside them, asked in every way whether they are empty.
import { basename, extname } from "node:path";
import { parse as parseQuery } from "node:querystring";
import { format } from "node:util";

function askText(text: string): string {
  let answers = "";
  answers += text === "" ? "1" : "0";
  answers += "" === text ? "1" : "0";
  answers += text !== "" ? "1" : "0";
  answers += text == "" ? "1" : "0";
  answers += text.length === 0 ? "1" : "0";
  answers += text.length !== 0 ? "1" : "0";
  answers += text.length == 0 ? "1" : "0";
  answers += text.length > 0 ? "1" : "0";
  answers += text.length >= 1 ? "1" : "0";
  answers += text.length < 1 ? "1" : "0";
  answers += text.length <= 0 ? "1" : "0";
  answers += 0 < text.length ? "1" : "0";
  answers += 1 > text.length ? "1" : "0";
  answers += 0 === text.length ? "1" : "0";
  answers += text.length ? "1" : "0";
  answers += !text.length ? "1" : "0";
  answers += text ? "1" : "0";
  answers += !text ? "1" : "0";
  answers += text.length === 1 ? "1" : "0";
  answers += text.length > 1 ? "1" : "0";
  answers += text.length >= 0 ? "1" : "0";
  return answers;
}

function askValue(value: any): string {
  let answers = "";
  answers += value === "" ? "1" : "0";
  answers += "" === value ? "1" : "0";
  answers += value !== "" ? "1" : "0";
  answers += value ? "1" : "0";
  return answers;
}

function isEmptyInALoop(texts: string[]): number {
  let empty = 0;
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] === "") empty++;
    if (texts[i].length === 0) empty += 10;
    if (texts[i].length > 0) empty += 100;
  }
  return empty;
}

const one: string = String(process.argv.length > 99 ? "xy" : "x");
const none: string = one.slice(1);
const url = new URL("http://example.com/");
const made: [string, string][] = [
  ["literal", ""],
  ["slice", one.slice(1)],
  ["slice from the end", one.slice(0, -1)],
  ["substring", one.substring(1)],
  ["substr", one.substr(1)],
  ["concat", none.concat(none)],
  ["sum", none + none],
  ["sum of three", none + none + none],
  ["template", `${none}${none}`],
  ["replace", one.replace(one, "")],
  ["replaceAll", one.replaceAll("x", "")],
  ["replace by a pattern", one.replace(/x/g, "")],
  ["trim", " ".trim()],
  ["trim of a made text", (one + " ").slice(1).trim()],
  ["String", String(none)],
  ["String of a list", String([])],
  ["join of nothing", [].join()],
  ["join of one", [none].join(",")],
  ["join of holes", Array(3).join("")],
  ["padEnd", none.padEnd(0)],
  ["padStart", none.padStart(0, one)],
  ["repeat zero times", one.repeat(0)],
  ["repeat of nothing", none.repeat(5)],
  ["JSON.parse", JSON.parse('""')],
  ["JSON.parse of a member", JSON.parse('{"a":""}').a],
  ["JSON.parse of an element", JSON.parse('[""]')[0]],
  ["TextDecoder", new TextDecoder().decode(new Uint8Array(0))],
  ["Buffer", Buffer.alloc(0).toString()],
  ["Buffer as hex", Buffer.from(none).toString("hex")],
  ["Buffer as base64", Buffer.from(none).toString("base64")],
  ["Buffer as latin1", Buffer.alloc(0).toString("latin1")],
  ["Buffer as utf16le", Buffer.alloc(0).toString("utf16le")],
  ["fromCharCode", String.fromCharCode()],
  ["fromCodePoint", String.fromCodePoint()],
  ["split, the last", (one + ",").split(",")[1]],
  ["split of nothing", none.split(",")[0]],
  ["group of exec", /(y?)/.exec(one)![1]],
  ["group of match", one.match(/(y?)/)![1]],
  ["whole match", /y*/.exec(one)![0]],
  ["search of a URL", url.search],
  ["hash of a URL", url.hash],
  ["user name of a URL", url.username],
  ["URLSearchParams", new URLSearchParams("a=").get("a")!],
  ["text of URLSearchParams", new URLSearchParams().toString()],
  ["querystring", parseQuery("a=").a as string],
  ["basename", basename("/")],
  ["extname", extname("a")],
  ["format", format("")],
  ["key of an object", Object.keys({ "": 1 })[0]],
  ["key of a map", new Map([["", 1]]).keys().next().value!],
  ["description of a symbol", Symbol("").description!],
  ["name of a function", (() => {}).name],
  ["message of an error", new Error().message],
  ["normalize", none.normalize()],
  ["toLowerCase", none.toLowerCase()],
  ["toUpperCase", none.toUpperCase()],
  ["boxed", String(new String(""))],
  ["value of a boxed text", new String("").valueOf()],
  ["list plus text", [] + ""],
  ["atob", atob("")],
  ["btoa", btoa("")],
  ["encodeURIComponent", encodeURIComponent(none)],
  ["decodeURIComponent", decodeURIComponent(none)],
  ["Headers", new Headers({ a: "" }).get("a")!],
  ["String.raw", String.raw``],
  ["charAt beyond the end", one.charAt(5)],
  ["toString", none.toString()],
  ["at the end of an iterator", [...none].join("")],
  ["toWellFormed", none.toWellFormed()],
  ["source of flags", /x/.flags],
];

for (const [name, text] of made)
  console.log(name, askText(text), askValue(text), askText(text + one), askValue(text + one));
console.log(isEmptyInALoop(made.map(pair => pair[1])), isEmptyInALoop(made.map(pair => pair[1] + one)));
for (const value of [undefined, null, 0, -0, NaN, false, [], {}, 0n, Symbol.iterator, new String("")])
  console.log(typeof value, askValue(value));
console.log(
  (await new Response("").text()) === "",
  (await new Response("").text()).length === 0,
  (await new Blob([]).text()) === "",
);
