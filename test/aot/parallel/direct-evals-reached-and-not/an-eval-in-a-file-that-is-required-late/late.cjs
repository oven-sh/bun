let kept = 1;
function helper(text) { return text + " through the helper"; }
exports.run = text => eval(text);
exports.read = () => kept;
