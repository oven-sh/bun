exports.f = () => 1;
for (exports.f of [function () { return this; }]);
