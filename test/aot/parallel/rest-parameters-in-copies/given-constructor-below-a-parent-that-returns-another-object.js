const other = { other: true };
class Returns { constructor(flag) { if (flag) return other; this.mine = 1; } }
class Given extends Returns { field = "field"; }
for (let i = 0; i < 4; i++) {
  const made = new Given(i & 1);
  console.log(made === other, made instanceof Given, made.field, made.mine, Object.keys(made).join());
  delete other.field;
}
