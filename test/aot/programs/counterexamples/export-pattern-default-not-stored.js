// `[exports.f = first] = [second]` stores second: calls of `exports.f` run it.
[exports.f = () => "first"] = [() => "second"];
console.log(exports.f());
