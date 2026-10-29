
function makeUser(name: string, age: number) { return { name, age, tags: [name] }; }
function older(user: { name: string; age: number; tags: string[] }, by: number) { return makeUser(user.name, user.age + by); }
function show(user: { name: string; age: number; tags: string[] }) { return user.name + " " + user.age + " " + user.tags.join(","); }
const api = { makeUser, older, show };
const which = process.argv[2] ?? "show";
console.log((api as any)[which](older(makeUser("x", 3), 4)));
