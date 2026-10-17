// The same writes to a locked host prototype and to Array.prototype, from sloppy and from strict code: a host prototype answers each write as a built-in prototype of the language does.
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
    const answers = holders.map(([name, prototype, method]) => {
      const before = (prototype as Record<string, unknown>)[method];
      const descriptor = getOwnPropertyDescriptor(prototype, method)!;
      const parent = getPrototypeOf(prototype);
      let answer: string;
      try {
        answer = String(work(prototype, method));
      } catch (error) {
        answer = "throws " + (error as Error).constructor.name + ": " + (error as Error).message.replaceAll(name, "<class>").replaceAll("'" + method + "'", "<method>");
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
      const withoutAdvice = answers[i].replace(". Use a subclass of <class> or a wrapper function instead", "");
      if (i > 0) lines[count++] = `${mode}: ${label}: ${name}.prototype: ${withoutAdvice === language ? "the same" : answers[i]}`;
    });
  }
}
console.log(lines.join("\n"));
