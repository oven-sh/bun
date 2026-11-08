class Above { who() { return "above"; } static kind() { return "Above"; } }
class Other { who() { return "other"; } static kind() { return "Other"; } }
class Below extends Above { own() { return this.who(); } }
Object.setPrototypeOf(Below, Other);
console.log(Below.kind(), new Below().own(), Object.getPrototypeOf(Below) === Other, Object.getPrototypeOf(Below.prototype) === Above.prototype);
class Next extends Above { own() { return this.who(); } }
Object.setPrototypeOf(Next.prototype, Other.prototype);
console.log(Next.kind(), new Next().own(), new Next() instanceof Above, new Next() instanceof Other);
