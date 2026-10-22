class Owner {
  name = "ann";
}
const full = { owner: new Owner() };
console.log({ ...full });
