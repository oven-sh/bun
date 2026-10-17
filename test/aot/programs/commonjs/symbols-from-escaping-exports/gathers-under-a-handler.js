"use strict";
let user;
try { user = require("./user-under-a-handler"); } catch (error) { user = null; }
exports.user = user;
exports.keys = require("./keys-under-a-handler");
