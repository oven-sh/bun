exports.f = () => "first";
for (exports.f of [() => "second"]);
