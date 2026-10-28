// What stands behind `...` in a list or among arguments throws while it is walked. The program prints the frames of each error.
const lib = {
  *boom() {
    throw new Error("boom");
  },
  trap() {
    return {
      get value() {
        throw new Error("trap");
      },
    };
  },
  get list() {
    return lib.boom();
  },
};
const other = lib;
const flag = Date.now() > 0;
const make = async () => lib;
const take = (...values) => values.length;
class Taker {
  constructor(...values) {}
}
let kept;
const forms = [
  () => [...(0, lib.boom)()],
  async () => [...(await make()).boom()],
  () => [...(lib ?? other).boom()],
  () => [...(flag ? lib : other).boom()],
  () => [...lib.boom()],
  () => [1, ...(0, lib.boom)()],
  () => take(...(0, lib.boom)()),
  () => new Taker(...(0, lib.boom)()),
  () => ({ ...(0, lib.trap)() }),
  () => [
    ...(function* () {
      throw new Error("inner");
    })(),
  ],
  () => [...(() => lib.boom())()],
  () => [...(lib.trap, lib).boom()],
  () => [...(-1, lib.boom)()],
  () => [...(lib.list || other.list)],
  () => [...(lib, other.list)],
  () => [...(kept = lib.boom())],
  () => [...lib.boom()],
  async () => [...(await make()).list],
  async () => [...(await lib.list)],
  () => ({ ...(lib ?? other).trap() }),
  async () => ({ ...(await make()).trap() }),
  () => take(1, ...(lib ?? other).boom()),
  async () => take(...(await make()).boom()),
  () => [...(lib || other)["boom"]()],
  () => [...(lib?.boom)()],
  () => [...(flag && lib).boom()],
  () => [...(lib ?? other).boom(), 2],
  () => [...(lib ?? other).boom()],
  () => [.../* note */ (lib ?? other).boom()],
  () => [...(lib ?? other).boom()],
  () => [...(typeof lib === "object" ? lib : other).list],
  () => [...(!lib || lib).list],
  () => [...(new Taker(), lib).list],
];
let index = 0;
for (const form of forms) {
  index++;
  try {
    await form();
    console.log(index, "no error");
  } catch (error) {
    console.log(
      index,
      error.stack
        .split("\n")
        .map(text => /^\s*at (.*?) ?\(?[^ ()]*[\/\\][\w.-]+:(\d+):(\d+)\)?$/.exec(text))
        .filter(found => found !== null)
        .map(found => found[1] + "@" + found[2] + ":" + found[3])
        .join(" < "),
    );
  }
}
