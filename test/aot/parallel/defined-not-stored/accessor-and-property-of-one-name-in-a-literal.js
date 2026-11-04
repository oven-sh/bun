const first = { get member() { return "the getter"; }, member: "the property" };
const second = { member: "the property", get member() { return "the getter"; } };
console.log(first.member, Object.getOwnPropertyDescriptor(first, "member").writable, second.member, typeof Object.getOwnPropertyDescriptor(second, "member").get);
