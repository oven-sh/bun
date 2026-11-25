// Flags: --minify-syntax
// Reference: bun build --compile
// A name that a call passes is no name that the file writes: what it reads is asked at run time, also where the function has a copy for the call.
process.env.NODE_ENV = "stored";
const readers = {};
readers.create = function (key) { return (suffix) => process.env[key] + suffix; };
const environment = readers.create("NODE_ENV"), home = readers.create("NO_SUCH_VARIABLE");
for (let i = 0; i < 2; i++) console.log(environment(i), home(i));
process.env.NODE_ENV = "stored again";
for (let i = 0; i < 2; i++) console.log(environment(i), home(i));
function createReader(key) {
  return class {
    get() { return process.env[key]; }
    has() { return key in process.env; }
    remove() { return delete process.env[key]; }
  };
}
const Environment = createReader("NODE_ENV"), Home = createReader("NO_SUCH_VARIABLE");
console.log(new Environment().get(), new Home().get(), new Environment().remove(), new Environment().get(), new Environment().has());
