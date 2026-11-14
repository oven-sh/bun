import { expect, test } from "bun:test";

const holdsValue = (object: object, name: string) => {
  void (object as any)[name];
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value !== "function";
};

test("no member of process or Bun that Program::isHostObjectDataProperty() names is an accessor, inherited or absent", () => {
  const ofProcess = [
    "env",
    "stdout",
    "stderr",
    "stdin",
    "pid",
    "version",
    "versions",
    "execPath",
    "argv0",
    "platform",
    "arch",
    "release",
    "features",
    "config",
    "isBun",
    "browser",
    "send",
    "channel",
  ];
  const ofBun = ["env", "version", "revision", "stdout", "stderr", "stdin", "argv", "cwd", "isMainThread"];
  expect(ofProcess.filter(name => !holdsValue(process, name))).toEqual([]);
  expect(ofBun.filter(name => !holdsValue(Bun, name))).toEqual([]);
});
