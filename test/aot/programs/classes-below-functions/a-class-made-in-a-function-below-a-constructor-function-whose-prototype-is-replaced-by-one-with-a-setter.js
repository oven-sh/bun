function Above() {
  this.n = 1;
  this.scale();
  this.total = this;
}
try { new Above(); } catch (error) { console.log(error.name); }
Above.prototype = {};
function declare() {
  return class extends Above {
    scale() {}
  };
}
const Below = declare();
for (let round = 0; round < 3; round++) {
  try {
    const made = new Below();
    console.log(made.n, made.total === made, made instanceof Above, Object.keys(made).join());
    Above.prototype = { set total(value) { console.log("setter"); } };
  } catch (error) { console.log(error.name); }
}
