module.exports = main;
function main(a, b) { return "main"; }
main.helper = () => "helper";
module.exports.version = "1.0";
main.viaSelf = () => main.helper() + "|" + module.exports.helper();
