function Base() {}
Base.prototype.hello = function () { return "base"; };
function Below() { this.tag = 1; }
Below.prototype = Object.create(Base.prototype);
Below.prototype.more = function () { return "more"; };
let answers = "";
for (let i = 0; i < 300; i++) answers = new Below().hello() + new Below().more();
console.log(answers);
