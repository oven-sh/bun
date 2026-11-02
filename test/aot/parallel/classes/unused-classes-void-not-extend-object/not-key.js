const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
!class {
  [key]() {}
};
