const required = require("./files/required.json")
exports.a = required.a
exports.dashed = require("./files/required.json")["b-c"]
exports.keys = Object.keys(required).join()
