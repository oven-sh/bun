try { require("./thrown"); exports.thrown = "no error"; } catch (e) { exports.thrown = e.message; }
try { require("./always"); exports.always = "no error"; } catch (e) { exports.always = e.message; }
