// The same writes to a host prototype, to Array.prototype and to Map.prototype, from sloppy and from strict code. Sloppy code gets the TypeError that strict code gets. All of them keep their members, their prototype and their missing index keys, with the same answers. A name of the program's own is taken by Array.prototype and Map.prototype as in plain Bun, and refused by a host prototype, which takes no new key at all.
// @ts-ignore
import { attempts as sloppy } from "./sloppy.cjs";
// @ts-ignore
import { attempts as strict } from "./strict.cjs";

type Attempt = [label: string, work: (prototype: object, method: string) => unknown];
const holders: [string, object, string][] = [
  ["Array", Array.prototype, "push"],
  ["Map", Map.prototype, "get"],
  ["Request", Request.prototype, "text"],
  ["Response", Response.prototype, "json"],
  ["Blob", Blob.prototype, "slice"],
  ["Headers", Headers.prototype, "get"],
  ["URL", URL.prototype, "toJSON"],
  ["URLSearchParams", URLSearchParams.prototype, "get"],
];
const { defineProperty, getOwnPropertyDescriptor, getPrototypeOf, setPrototypeOf } = Object;
const lines: string[] = [];
let count = 0;
for (const [mode, attempts] of [["sloppy", sloppy], ["strict", strict]] as [string, Attempt[]][]) {
  for (const [label, work] of attempts) {
    const answers = holders.map(([, prototype, method]) => {
      const before = (prototype as Record<string, unknown>)[method];
      const descriptor = getOwnPropertyDescriptor(prototype, method)!;
      const parent = getPrototypeOf(prototype);
      let answer: string;
      try {
        answer = String(work(prototype, method));
      } catch (error) {
        answer = "throws " + (error as Error).constructor.name;
      }
      const unchanged = (prototype as Record<string, unknown>)[method] === before && !("added" in prototype) && getPrototypeOf(prototype) === parent;
      if (!unchanged) {
        setPrototypeOf(prototype, parent);
        defineProperty(prototype, method, descriptor);
        delete (prototype as Record<string, unknown>).added;
      }
      return answer + (unchanged ? "" : " AND IT CHANGED");
    });
    const language = answers[0];
    lines[count++] = `${mode}: ${label}: Array.prototype: ${language}`;
    holders.forEach(([name], i) => {
      if (i > 0) lines[count++] = `${mode}: ${label}: ${name}.prototype: ${answers[i] === language ? "the same" : answers[i]}`;
    });
  }
}
console.log(lines.join("\n"));
