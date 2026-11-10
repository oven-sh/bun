import { test } from "bun:test";
const reads = (name: string) => [({} as any)[name], name in {}, Object.keys({}).length];
function byClimb() {
  const above: any = Object.getPrototypeOf({});
  above.tint = "climbed";
  try {
    return [({} as any).tint, reads("tint")];
  } finally {
    delete above.tint;
  }
}
function byReflect() {
  const above: any = Reflect.getPrototypeOf({ kept: 1 });
  Reflect.set(above, "grain", "reflected");
  try {
    return [({} as any).grain, reads("grain")];
  } finally {
    Reflect.deleteProperty(above, "grain");
  }
}
function byPattern() {
  const { __proto__: above } = {} as any;
  above.hue = "taken apart";
  try {
    return [({} as any).hue, reads("hue")];
  } finally {
    delete above.hue;
  }
}
function ofAnotherReceiver() {
  const above: any = Reflect.get({}, "__proto__", []);
  return above === Array.prototype;
}
function hiddenByAnOwnKey() {
  const held = { mark: 1 };
  const above: any = ({ ["__proto__"]: held } as any)["__proto__"];
  above.own = "own";
  return [above === held, (held as any).own, ({} as any).own];
}
test("t", () => {
  console.log(
    "SAID",
    byClimb(),
    byReflect(),
    byPattern(),
    ofAnotherReceiver(),
    hiddenByAnOwnKey(),
    reads("tint"),
    reads("grain"),
    reads("hue"),
  );
});
