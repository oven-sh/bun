class Owner {
  name = "ann";
}
const full = { owner: new Owner() };
const { ...rest } = full;
console.log(rest);
