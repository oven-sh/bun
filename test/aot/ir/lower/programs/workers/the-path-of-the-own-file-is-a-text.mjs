// The engine reads the file that a Worker starts from off a text. What is made of the path of the file itself is known when the program is built.
// RUN: lower
// CHECK-LABEL: function {{*}}name="byUrl"
// CHECK: [[url]] = String string="file:///$bunfs/root/main.mjs"
// CHECK: Construct {{*}}, -, [[url]] calleeName="Worker"
// CHECK-LABEL: function {{*}}name="byPath"
// CHECK: [[path]] = String string="/$bunfs/root/main.mjs"
// CHECK: Construct {{*}}, -, [[path]] calleeName="Worker"
// CHECK-LABEL: function {{*}}name="byFolder"
// CHECK: [[beside]] = String string="/$bunfs/root/job.mjs"
// CHECK: Construct {{*}}, -, [[beside]], {{*}}calleeName="Worker"
// CHECK-LABEL: function {{*}}name="byTemplate"
// CHECK: [[below]] = String string="/$bunfs/root/lib/job.mjs"
// CHECK: Construct {{*}}, -, [[below]] calleeName="Worker"
// CHECK-LABEL: function {{*}}name="inPart"
// CHECK: [[part]] = Add
// CHECK: Construct {{*}}, -, [[part]] calleeName="Worker"
// CHECK-LABEL: function {{*}}name="ofAnotherClass"
// CHECK: [[own]] = PropGet {{*}}key="url"
// CHECK: Construct {{*}}, -, [[own]] calleeName="URL"

// FILE: main.mjs
export const byUrl = function byUrl() { return new Worker(import.meta.url); };
export const byPath = function byPath() { return new Worker(import.meta.filename); };
export const byFolder = function byFolder() { return new Worker(import.meta.dir + "/job.mjs", { name: "helper" }); };
export const byTemplate = function byTemplate() { return new Worker(`${import.meta.dirname}/lib/` + "job.mjs"); };
export const inPart = function inPart(name) { return new Worker(import.meta.dir + name); };
export const ofAnotherClass = function ofAnotherClass() { return new URL(import.meta.url); };

// FILE: job.mjs
postMessage(1);

// FILE: lib/job.mjs
postMessage(2);
