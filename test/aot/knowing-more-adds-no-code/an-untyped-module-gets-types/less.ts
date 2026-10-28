
function makeUser(name: any, age: any) { return { name, age, tags: [name] }; }
function older(user: any, by: any) { return makeUser(user.name, user.age + by); }
function show(user: any) { return user.name + " " + user.age + " " + user.tags.join(","); }
const api = { makeUser, older, show };
const which = process.argv[2] ?? "show";
console.log((api as any)[which](older(makeUser("x", 3), 4)));
