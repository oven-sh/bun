console.log("other runs");
new Function("name", "return import(name)")(import.meta.resolve("./running.mjs")).then(
  names => console.log("import of running: fulfilled, ended:", names.ended),
  error => console.log("import of running: rejected,", error.message),
);
