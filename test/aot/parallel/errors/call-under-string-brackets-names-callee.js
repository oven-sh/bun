// A member is called under a string in brackets. The message names the callee as `bun run` does, which prints `o["b"]` as `o.b` before it runs the file and leaves `o["e-f"]` as it is.
const o = JSON.parse('{ "b": {}, "c": { "d": 5 }, "e-f": 1, "class": 2 }');
const say = f => {
  try {
    f();
  } catch (error) {
    console.log(error.message);
  }
};
say(() => o["b"]());
say(() => o["c"]["d"]());
say(() => o.c["d"]());
say(() => o["c"].d());
say(() => o?.["b"]());
say(() => o["e-f"]());
say(() => o["class"]());
say(() => o[`b`]());
say(() => new o["b"]());
say(() => {
  const r = o["b"]();
  return [r];
});
say(() => o["not there"]());
say(() => o["0"]());
say(() => o[""]());
say(() => o.c["e-f"]());
say(() => o?.["e-f"]());
