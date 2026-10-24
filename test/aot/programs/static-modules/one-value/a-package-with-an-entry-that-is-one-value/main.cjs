// A small server framework in the form of hand-written npm packages: every module is one value, the entry has members behind it, and three files read them by name, by pattern and by call.
const framework = require("./framework/index.js");
const { Router, errors } = require("./framework/index.js");
const app = framework();
app.router.get("/", () => "home");
console.log(app.handle("GET", "/"));
console.log(app.handle("GET", "/missing"));
console.log(app.router instanceof Router, errors === framework.errors, framework.created());
