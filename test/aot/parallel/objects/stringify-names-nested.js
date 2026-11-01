class Returned {
  get p() {
    return 1;
  }
}
class Deep {
  get p() {
    return 2;
  }
}
class Pushed {
  get p() {
    return 3;
  }
}
class Held {
  get p() {
    return 4;
  }
}
const above = {
  get p() {
    return 5;
  },
};
const list = [];
list.push(new Pushed());
console.log(
  JSON.stringify(
    {
      toJSON() {
        return new Returned();
      },
    },
    ["p"],
  ),
);
console.log(JSON.stringify([[new Deep()]], ["p"]));
console.log(JSON.stringify(list, ["p"]));
console.log(JSON.stringify({ held: new Held() }, ["held", "p"]));
console.log(JSON.stringify([Object.create(above)], ["p"]), JSON.stringify([{ __proto__: above }], ["p"]));
