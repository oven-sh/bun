// `exports = module.exports = createApplication` behind the requires of the file, and members stored through `exports` behind that. One of the modules it requires is `var app = exports = module.exports = {}`, one is a constructor function, one is a function with a member.
const express = require("./express.cjs");
const { Router, json } = express;
const app = express();
console.log(app("request"), typeof express.application.handle, express.Router === Router, Router().use(json).stack.length, new express.Router().stack.length);
console.log(express.static("public")(), express.static.mime.html, json(), Object.keys(express).join());
