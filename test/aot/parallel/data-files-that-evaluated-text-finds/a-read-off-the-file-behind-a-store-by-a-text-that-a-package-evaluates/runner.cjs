exports.run = text => new Function("return " + text)();
