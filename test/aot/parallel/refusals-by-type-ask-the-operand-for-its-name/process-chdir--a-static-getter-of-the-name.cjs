"use strict";
class Made {
  static get name() {
    console.log("asked");
    return "Made";
  }
}
try {
  process.chdir(new Made());
  console.log("taken");
} catch (error) {
  console.log(error.name, error.code, "|", String(error.message).slice(0, 200));
}
process.exit(0);
