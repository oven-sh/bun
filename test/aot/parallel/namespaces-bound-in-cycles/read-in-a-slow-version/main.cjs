// calls-import.mjs calls import() on file.cjs while this require() loads it. imports-back.ts, which the file requires, imports the file back and is bound to what the file has exported so far.
// Whoever asks later gets what it has exported when its body has ended: another namespace object. tell() hands on the one that its module was bound to, in its fast version and in the one that runs where its guard turns away.
require("./calls-import.mjs");
