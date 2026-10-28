// The modules of the runtime may keep a method, an accessor or a stored function under a name that no program can write, on a prototype, a class or a literal.
// The fixture asks for each of them through an instance. The interpreter and the executable must answer alike, and nothing lists such a name.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told, unsupported } from "./run-programs";

const fixture = join(import.meta.dir, "members-under-names-of-the-runtime.fixture.mjs");
const env = bunEnv;

test("the interpreter finds members under names of the runtime, and lists none", async () => {
  const plain = await spawned([bunExe(), fixture], import.meta.dir, env);
  expect(plain.stdout.split("\n").filter(line => /^(a class|a class that captures|a function) /.test(line))).toEqual([
    "a class $isOpen: method a",
    "a class $written: method b",
    "a class $exchange: getter",
    "a class $writer: getter",
    "a class $exchange =: 1",
    "a class $writer =: 2",
    "a class $isPrepared: static",
    "a class $warning: static",
    "a class under no such name: undefined undefined",
    "a class keys:  | constructor",
    "a class keys of the constructor: length,name,prototype",
    "a class that captures $isOpen: tag method a",
    "a class that captures $written: tag method b",
    "a class that captures $exchange: tag getter",
    "a class that captures $writer: tag getter",
    "a class that captures $exchange =: tag 1",
    "a class that captures $writer =: tag 2",
    "a class that captures $isPrepared: tag static",
    "a class that captures $warning: tag static",
    "a class that captures under no such name: undefined undefined",
    "a class that captures keys:  | constructor",
    "a class that captures keys of the constructor: length,name,prototype",
    "a function $isOpen: tag stored a",
    "a function $written: tag stored b",
    "a function $exchange: undefined",
    "a function $writer: undefined",
    "a function $exchange =: nothing",
    "a function $writer =: nothing",
    "a function $isPrepared: undefined",
    "a function $warning: undefined",
    "a function under no such name: undefined undefined",
    "a function keys:  | constructor",
    "a function keys of the constructor: length,name,prototype",
  ]);
  expect(plain.exitCode).toBe(0);
});

test.skipIf(!!unsupported)(
  "compile/aot/members under names of the runtime answer as in the interpreter",
  () =>
    slot(async () => {
      using dir = tempDir("aot-members-under-names-of-the-runtime", {});
      const executable = join(String(dir), "program");
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", fixture, "--outfile", executable], String(dir), env),
      );
      const plain = await spawned([bunExe(), fixture], String(dir), env);
      const compiled = await spawned([executable], String(dir), env);
      expect(compiled.signal).toBeNull();
      expect(told(compiled)).toEqual(told(plain));
    }),
  600_000,
);
