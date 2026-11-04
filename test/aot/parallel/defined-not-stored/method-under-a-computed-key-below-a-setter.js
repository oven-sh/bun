const key = ["mem", "ber"].join("");
class Above { set member(value) { console.log("the setter ran"); } }
class Below extends Above { [key]() { return "the method"; } static [key]() { return "the static method"; } }
console.log(new Below().member(), Below.member());
