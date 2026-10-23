// `Message.prototype.url = "";` A default on the prototype is Node's own idiom, and that of every library written before classes.
// The constructor's `this.url = url` finds a writable data property above the object and creates the property of the object,
// exactly as where nothing is above it. So the lines that store the defaults may cost the constructor nothing: no access goes
// by name each round because of them, and none asks the run time's C++ each round.
//
//   AOT_DEFAULTS=<text>    only the idioms whose name contains the text
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported-with-counted-calls";

// `make(i)` answers an object. The lines between the two marks store the defaults.
const idioms: Record<string, string> = {
  "a constructor function": `
    function Message(socket, url, method) {
      this.socket = socket;
      this.complete = false;
      this.upgrade = null;
      this.url = url;
      this.method = method;
    }
    //<
    Message.prototype.url = "";
    Message.prototype.method = null;
    Message.prototype.upgrade = null;
    //>
    const make = i => new Message(i, "/a", "GET");`,
  "a constructor function below another": `
    function Emitter() {
      this.listeners = null;
      this.count = 0;
    }
    function Message(url) {
      Emitter.call(this);
      this.url = url;
      this.ended = false;
    }
    Object.setPrototypeOf(Message.prototype, Emitter.prototype);
    //<
    Emitter.prototype.count = 0;
    Message.prototype.ended = false;
    //>
    const make = i => new Message("/a");`,
  "a class": `
    class Message {
      constructor(url) {
        this.url = url;
        this.ended = false;
      }
    }
    //<
    Message.prototype.url = "";
    Message.prototype.ended = false;
    //>
    const make = i => new Message("/a");`,
  "a default under a symbol": `
    const kState = Symbol("kState");
    function Stream(state) {
      this.flowing = true;
      this[kState] = state;
    }
    //<
    Stream.prototype[kState] = 0;
    //>
    const make = i => new Stream(i);`,
  "a field that only some objects get": `
    function Message(url) {
      this.id = 1;
      if (url !== undefined) this.url = url;
    }
    //<
    Message.prototype.url = "";
    //>
    const make = i => new Message(i & 1 ? "/a" : undefined);`,
};

function program(idiom: string, withDefaults: boolean) {
  return `${withDefaults ? idiom : idiom.replace(/\/\/<[^]*\/\/>/, "")}
    const rounds = Number(process.argv[2]);
    let keys = 0;
    for (let i = 0; i < rounds; i++) keys += Object.keys(make(i)).length;
    console.log(keys > 0);
  `;
}

async function measure(folder: string, name: string) {
  const executable = join(folder, isWindows ? `${name}.exe` : name);
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "--aot-count-arrivals", `./${name}.mjs`, "--outfile", executable],
      folder,
      bunEnv,
    ),
  );
  const counted = async (rounds: number) => {
    const path = join(folder, `${name}-${rounds}`);
    const ran = await spawned([executable, String(rounds)], folder, {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      BUN_JSC_aotCountsPath: path,
    });
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
    const operations = new Map<string, number>();
    let byName = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, what] = line.split("\t");
      if (what?.startsWith("operation:")) operations.set(what, Number(count));
      if (what?.startsWith("arrival:")) byName += Number(count);
    }
    return { operations, byName };
  };
  const [few, many] = [await counted(500), await counted(4500)];
  return {
    byNameEachRound: Math.round((many.byName - few.byName) / 4000),
    askedEachRound: [...many.operations]
      .filter(([operation, count]) => count - (few.operations.get(operation) ?? 0) > 400)
      .map(([operation]) => operation)
      .sort(),
  };
}

const only = process.env.AOT_DEFAULTS;

describe.concurrent("a default on the prototype costs the constructor nothing", () => {
  for (const [name, idiom] of Object.entries(idioms)) {
    if (only && !name.includes(only)) continue;
    // TODO: with the defaults, each construction of the class stores two fields by name.
    (name === "a class" ? test.todo : test)(
      name,
      async () => {
        using dir = tempDir("aot-defaults-on-prototypes", {
          "with.mjs": program(idiom, true),
          "without.mjs": program(idiom, false),
        });
        expect(await measure(String(dir), "with")).toEqual(await measure(String(dir), "without"));
      },
      240_000,
    );
  }
});
