class Above {}
Object.defineProperty(Above.prototype, "member", { value: "above", writable: false });
class Below extends Above { member = "the field"; }
console.log(new Below().member, new Above().member);
