// An error in a function that is one long line quotes what `bun run` quotes.
//
// The message of a TypeError quotes what failed, and an executable looks for that in the text around the place. In a file that a
// minifier has written the line of the place is the whole function, or a whole bundle that is wrapped in a function. So in a long
// line the compiler lists where some of the statements begin, and only what stands between two of them is looked through.
//
// That is right as long as nothing that is quoted holds one of the listed starts. A call may hold the statements of a function
// that is written among its arguments, a constant may have been put where it is read, in a later statement, and a minifier joins
// what was a statement each with commas, in lists of declarations, in results, in conditions and behind `&&`.
//
// So here a function of about 20 KB in one line fails at two hundred places, one a call, in many forms, between fillers of
// many lengths, so that the listed starts fall everywhere among them. It is written once for each way to join its parts, and
// every message is held against what `bun run` says.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { describe, test } from "./supported";

// What fails, as an expression. The number makes each a place with names of its own.
const failing: ((n: number) => string)[] = [
  n => `none.a${n}`,
  n => `none.a${n}.b`,
  n => `held.f${n}()`,
  n => `held.f${n}(1,[2,3],"a;b)")`,
  n => `run(function(){held.x=1;held.y=2;return held}).z${n}.w`,
  n => `run(function(){held.x=1;held.y=2;return held}).z${n}()`,
  n => `run(()=>{held.x=1;held.y=2}).z${n}.w`,
  n => `held instanceof held.n${n}`,
  n => `new held.K${n}(1)`,
  n => `delete none.d${n}`,
  n => `none[held.key${n}]`,
  n => `none["two words ${n}"]`,
  n => `held.deep.er${n}.est`,
  n => `held.list[${n}].x`,
  n => `held.deep.f${n}(held.x,held.y).g`,
  n => `held.text.nothing${n}.length`,
  n => `none.s${n}=held.x+1`,
  n => `[...held.n${n}]`,
  n => `(function(){held.x=1;return none.r${n}})()`,
  n => `(()=>(held.x=1,none.q${n}))()`,
  n => `new(class{constructor(){held.x=1;none.k${n}}})`,
  n => `new(class{m(){held.x=1;held.y=2}constructor(){held.x=1;none.k${n}}n(){held.x=1}})`,
];
// What does not fail: quotes, brackets and semicolons in texts, and functions with statements of their own.
const fillers: ((n: number) => string)[] = [
  n => `held.x=held.x+${n}`,
  n => `held.text="a;b'(["+${n}`,
  n => `held.text='}"])'+held.x+"${"x".repeat(n % 23)}"`,
  n => `held.y=[held.x,${n}].length`,
  n => `held.text=\`\${held.x};'\${${n}}\``,
  n => `held.y=/[;)\\]]/.test(held.text)`,
  n => `held.last=function(a){held.x=a;return a+${n}}`,
];

type Unit = { fails: boolean; n: number; text: string };
const units: Unit[] = Array.from({ length: 600 }, (_, n) =>
  n % 3 === 1
    ? { fails: true, n, text: failing[((n - 1) / 3) % failing.length](n) }
    : { fails: false, n, text: fillers[n % fillers.length](n) },
);
const statements = units.map(unit => (unit.fails ? `if(step===${unit.n})${unit.text};` : `${unit.text};`)).join("");
const expressions = units.map(unit => (unit.fails ? `step===${unit.n}&&(${unit.text})` : unit.text)).join(",");

// `go(step)` fails at the place of that number.
const joined = {
  "statements": `function go(step){${statements}}`,
  "statements in blocks": `function go(step){if(held){try{${units.map(unit => (unit.fails ? `if(step===${unit.n}){${unit.text}}` : `{${unit.text}}`)).join("")}}finally{held.x=0}}}`,
  "cases": `function go(step){switch(step){${units.map(unit => `case ${unit.n}:${unit.text};break;`).join("")}}}`,
  "declarations": `function go(step){var ${units.map(unit => `v${unit.n}=${unit.fails ? `step===${unit.n}&&` : ""}(${unit.text})`).join(",")}}`,
  "expressions": `function go(step){${expressions}}`,
  "a result": `function go(step){return ${expressions}}`,
  "an arrow function": `var go=step=>(${expressions});`,
  "a condition": `function go(step){if(${expressions})held.x=1}`,
  "behind a test": `function go(step){held&&(${expressions})}`,
  "arms": `function go(step){held?(${units.map(unit => (unit.fails ? `step===${unit.n}?(${unit.text}):0` : unit.text)).join(",")}):0}`,
  "a constructor": `class K{before(){held.x=1;held.y=2}constructor(step){${statements}}after(){held.x=1;held.y=2}}function go(step){new K(step)}`,
  "a method": `class K{before(){held.x=1;held.y=2}go(step){${statements}}}function go(step){new K().go(step)}`,
  "loops and lists": `function go(step){${units.map(unit => (unit.fails ? `if(step===${unit.n})${[`for (const x of held.n${unit.n}){held.x=x}`, `do{held.x=1}while(none.w${unit.n});`, `{const[a,b]=held.p${unit.n};held.x=a}`][((unit.n - 1) / 3) % 3]}` : `${unit.text};`)).join("")}}`,
  "constants that are read once": `function go(step){${units.map(unit => (unit.fails ? `if(step===${unit.n}){const r=run(held.last);held.x=r.c${unit.n}.d}` : `${unit.text};`)).join("")}}`,
};
const head = `var none=globalThis.nothingHere,held={x:0,y:0,text:"",deep:{},list:[],last:null},messages=[],steps=[${units.filter(unit => unit.fails).map(unit => unit.n)}];function run(f){f&&f(1);return held}`;
const tail = `console.log(JSON.stringify(messages));\n`;
const programs: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(joined).map(([name, go]) => [
      name,
      `${head}(function(){${go}for(const step of steps){try{go(step)}catch(e){messages.push(e.message)}}})();${tail}`,
    ]),
  ),
  "one statement of the file": `${head}for(const step of steps){try{switch(step){${units.map(unit => `case ${unit.n}:${unit.text};break;`).join("")}}}catch(e){messages.push(e.message)}}${tail}`,
  "declarations of the file": `${head}function t(f){try{f()}catch(e){messages.push(e.message)}}var ${units.map(unit => `v${unit.n}=${unit.fails ? `t(()=>(${unit.text}))` : `(${unit.text})`}`).join(",")};${tail}`,
};
const fileOf = (name: string) => name.replaceAll(" ", "-");

const dir = tempDir(
  "aot-errors-in-one-long-line",
  Object.fromEntries(Object.entries(programs).map(([name, text]) => [`${fileOf(name)}.js`, text])),
);
afterAll(() => dir[Symbol.dispose]());
const folder = String(dir);

describe.concurrent("every message of a function in one long line is what bun run says", () => {
  for (const name of Object.keys(programs)) {
    test(
      name,
      async () => {
        const file = fileOf(name);
        const plain = await spawned([bunExe(), `./${file}.js`], folder, bunEnv, 200_000);
        expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
        const expected: string[] = JSON.parse(plain.stdout);
        expect(expected.length).toBe(200);

        const executable = join(folder, isWindows ? `${file}.exe` : file);
        built(
          await spawned(
            [bunExe(), "build", "--compile", "--aot", `./${file}.js`, "--outfile", executable],
            folder,
            bunEnv,
            400_000,
          ),
        );
        const ran = await spawned([executable], folder, bunEnv, 200_000);
        expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
        expect(JSON.parse(ran.stdout)).toEqual(expected);
      },
      480_000,
    );
  }
});
