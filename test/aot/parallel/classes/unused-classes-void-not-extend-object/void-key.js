const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
void class {
  [key]() {}
};
