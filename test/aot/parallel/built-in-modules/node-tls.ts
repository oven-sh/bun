import * as library from "node:tls";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.getCiphers().length > 0, library.DEFAULT_MIN_VERSION);
for (const host of ["a.test", "db.1", "127.1", "0X7f.1.", "127\u30021", "1.2.3.4.5"]) {
  console.log((library.checkServerIdentity(host, { subject: { CN: host } } as any) as any)?.reason);
}
