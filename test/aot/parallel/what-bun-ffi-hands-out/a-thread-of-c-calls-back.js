// A callback that any thread may enter is called on the thread of the program, behind the call of C that started the other thread.
import { dlopen, JSCallback, ptr } from "bun:ffi";

const names = ["libc.so.6", "libpthread.so.0", `libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`];

function open() {
  for (const name of process.platform === "linux" ? names : []) {
    try {
      return dlopen(name, {
        pthread_create: { args: ["ptr", "ptr", "ptr", "ptr"], returns: "i32" },
        pthread_join: { args: ["u64", "ptr"], returns: "i32" },
      });
    } catch {}
  }
}

const library = open();
const called = Promise.withResolvers();
const safe = new JSCallback(
  value => {
    called.resolve(value);
  },
  { args: ["ptr"], returns: "void", threadsafe: true },
);
if (library) {
  const thread = new BigUint64Array(1);
  if (library.symbols.pthread_create(ptr(thread), null, safe.ptr, null) !== 0) throw new Error("no thread was started");
  library.symbols.pthread_join(thread[0], null);
} else called.resolve(null);
console.log("called with", String(await called.promise), String(safe.threadsafe));
safe.close();
