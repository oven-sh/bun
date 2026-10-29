function self() {
  eval("0");
  return self;
}
console.log(self() === self, self()() === self, self().name);
