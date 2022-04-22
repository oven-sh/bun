const count = 999999;

function bench(label, cb) {
  console.time(label);
  cb();
  console.timeEnd(label);
}

for (let i = 0; i < count; i++) {}

bench("globalThis.Bun (C API)", () => {
  for (let i = 0; i < count; i++) {
    globalThis.Bun;
  }
});

bench("Bun (C API)", () => {
  for (let i = 0; i < count; i++) {
    Bun;
  }
});

var Bun = globalThis.Bun;

bench("Bun.gc (C API -> C API)", () => {
  for (let i = 0; i < count; i++) {
    Bun.gc;
  }
});

bench("Bun.gc copied to local variable", () => {
  var gc = Bun.gc;
  for (let i = 0; i < count; i++) {
    gc = gc;
  }
});

bench("process.version (C++ Custom Accessor)", () => {
  for (let i = 0; i < count; i++) {
    process.version;
  }
});

bench("process.env (C++ Custom Accessor -> C API)", () => {
  for (let i = 0; i < count; i++) {
    process.env;
  }
});

bench("C++ putDirect", () => {
  for (let i = 0; i < count; i++) {
    Event.AT_TARGET;
  }
});

bench("Inline", () => {
  var inline = { foo: 123 };

  for (let i = 0; i < count; i++) {
    inline.foo;
  }
});
