// The shorter roads of node:http ask first whether the methods that they leave out are still the library's own. An accessor of the program's on the request itself can tell how it is asked:
// it is asked as often as plain Bun asks it, and what it throws goes where it goes in plain Bun. What lies on one request is noticed for all, so in the executable every case is a process of its own.
// Plain Bun has no such roads and notices nothing: there one process answers all the cases of an answer, one after another.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { beforeAll, test } from "./supported";

const program = join(
  import.meta.dir,
  "an-accessor-on-a-request-itself-is-asked-as-often-as-plain-bun-asks-it",
  "one-accessor-a-process.mjs",
);

// The cases of the program, as it lists them.
// prettier-ignore
const names = [
  "_destroy", "_dump", "_read", "destroy", "emit", "listenerCount", "push", "read", "removeAllListeners", "resume",
  "_dumped", "complete", "writable", "_writableState", "_readableState", "_consuming", "_events", "_eventsCount",
  "readableEnded", "destroyed", "aborted", "readable", "on",
];
// What the client gets of each where no accessor is in the way.
const answers: Record<string, string> = {
  "end with a text": "ok",
  "the body by listeners": "ok100",
  "the body is left alone": "ok",
  "the body by readable and read": "ok100",
};
const deeds = ["only answers", "throws once"];
const cases = names.flatMap(name => Object.keys(answers).flatMap(answer => deeds.map(deed => [name, answer, deed])));
const titleOf = (words: string[]) => words.join(" . ");

let directory: ReturnType<typeof tempDir> | undefined;
let folder: string;
let executable: string;
/** What plain Bun printed for each case. */
const plain = new Map<string, string>();
afterAll(() => directory?.[Symbol.dispose]());

beforeAll(async () => {
  directory = tempDir("one-accessor-a-process", {});
  folder = String(directory);
  executable = join(folder, "one-accessor-a-process");
  const ofAnswer = Object.keys(answers).map(answer => cases.filter(words => words[1] === answer).map(titleOf));
  const [build, listed, ...ran] = await Promise.all([
    slot(() => spawned([bunExe(), "build", "--compile", "--aot", program, "--outfile", executable], folder, bunEnv)),
    slot(() => spawned([bunExe(), program], folder, bunEnv)),
    ...ofAnswer.map(titles =>
      slot(() => spawned([bunExe(), program], folder, { ...bunEnv, CASES: titles.join("\n") })),
    ),
  ]);
  built(build);
  expect(listed).toEqual({ stdout: cases.map(titleOf).join("\n") + "\n", stderr: "", exitCode: 0, signal: null });
  for (const [index, titles] of ofAnswer.entries()) {
    // A case prints its title, and below it a line for each request, which begins with blanks.
    const printed = ran[index].stdout.split(/^(?=\S)/m);
    expect({ ...ran[index], stdout: printed.map(lines => lines.slice(0, lines.indexOf("\n"))) }).toEqual({
      stdout: titles,
      stderr: "",
      exitCode: 0,
      signal: null,
    });
    titles.forEach((title, at) => plain.set(title, printed[at]));
  }
});

test("what the accessor throws is seen in plain Bun", () => {
  expect([...plain.values()].filter(printed => printed.includes("the accessor throws")).length).toBeGreaterThan(0);
});

test.concurrent.each(cases)("%s . %s . %s", async (name, answer, deed) => {
  const title = titleOf([name, answer, deed]);
  const reference = plain.get(title)!;
  // The first request finds no accessor, and an accessor that only answers changes no answer.
  const untouched = [1, 2, 3].map(request => `  request ${request} | "HTTP/1.1 200 OK" "${answers[answer]}" | \n`);
  if (deed === "only answers") expect(reference).toBe(title + "\n" + untouched.join(""));
  else expect(reference).toStartWith(title + "\n" + untouched[0]);
  const compiled = await slot(() => spawned([executable], folder, { ...bunEnv, CASES: title }));
  expect(compiled).toEqual({ stdout: reference, stderr: "", exitCode: 0, signal: null });
});
